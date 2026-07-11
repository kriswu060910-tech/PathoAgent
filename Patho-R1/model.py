"""Patho-R1 / Qwen-VL 模型加载与管理。"""

import asyncio
import gc

import torch
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

import config
from logger import setup_logger

logger = setup_logger("patho", config.PROJECT_ROOT / "logs")


class ModelManager:
    """封装模型与处理器的加载、访问和显存清理。"""

    def __init__(self) -> None:
        self._model: Qwen2_5_VLForConditionalGeneration | None = None
        self._processor: AutoProcessor | None = None
        # 模型生成不是线程/协程安全的，加锁保证串行推理
        self._inference_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    #  属性
    # ------------------------------------------------------------------

    @property
    def model(self) -> Qwen2_5_VLForConditionalGeneration | None:
        return self._model

    @property
    def processor(self) -> AutoProcessor | None:
        return self._processor

    @property
    def device(self) -> torch.device | None:
        return self._model.device if self._model else None

    def is_loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    @property
    def inference_lock(self) -> asyncio.Lock:
        return self._inference_lock

    # ------------------------------------------------------------------
    #  加载 / 卸载
    # ------------------------------------------------------------------

    def load(self, model_key: str) -> None:
        model_name = config.MODEL_MAP.get(model_key, config.MODEL_MAP["7b"])
        logger.info(f"Loading model: {model_name} ...")

        if torch.cuda.is_available():
            from transformers import BitsAndBytesConfig

            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                llm_int8_enable_fp32_cpu_offload=True,
            )
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_name,
                quantization_config=quant_config,
                device_map="auto",
                attn_implementation="sdpa",
            )
        else:
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_name,
                torch_dtype=torch.float32,
                device_map="cpu",
            )
        self._processor = AutoProcessor.from_pretrained(model_name)
        logger.info(f"Model loaded successfully on {self.device}")

    @staticmethod
    def cleanup_gpu() -> None:
        """释放 GPU 缓存，防止多次推理后 OOM。"""
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def unload(self) -> None:
        """显式卸载模型，释放显存。"""
        self._model = None
        self._processor = None
        self.cleanup_gpu()

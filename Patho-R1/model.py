"""Patho-R1 / Qwen-VL 模型加载与管理。"""

import asyncio
import gc
import os

# 强制离线模式：仅使用本地缓存，不联网下载模型
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

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

    @property
    def uses_accelerate(self) -> bool:
        """是否使用 accelerate 的 device_map 自动调度。"""
        if self._model is None:
            return False
        # device_map="auto" 会在模型上留下 hf_device_map
        return hasattr(self._model, "hf_device_map") and bool(self._model.hf_device_map)

    def is_loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    @property
    def inference_lock(self) -> asyncio.Lock:
        return self._inference_lock

    # ------------------------------------------------------------------
    #  加载 / 卸载
    # ------------------------------------------------------------------

    @staticmethod
    def _local_model_available(model_name: str) -> bool:
        """检查模型是否已缓存在本地（HuggingFace Hub cache 目录）。"""
        # 如果是本地路径，直接检查
        if os.path.isdir(model_name):
            return True
        # 检查 HF cache: ~/.cache/huggingface/hub/models--{org}--{name}/snapshots/
        hf_home = os.environ.get("HF_HOME", os.path.join(os.path.expanduser("~"), ".cache", "huggingface"))
        cache_dir = os.path.join(hf_home, "hub", "models--" + model_name.replace("/", "--"))
        snapshots = os.path.join(cache_dir, "snapshots")
        return os.path.isdir(snapshots) and len(os.listdir(snapshots)) > 0 if os.path.isdir(snapshots) else False

    def load(self, model_key: str, quantize: bool = True) -> None:
        model_name = config.MODEL_MAP.get(model_key, config.MODEL_MAP["7b"])

        if not self._local_model_available(model_name):
            raise RuntimeError(
                f"本地未找到模型 {model_name}。"
                f"请先在有网络的环境下运行一次 `python -c \"from transformers import AutoModel; AutoModel.from_pretrained('{model_name}')\"` 下载模型，"
                f"或通过 huggingface-cli download {model_name} 下载到本地缓存。"
            )

        use_cuda = torch.cuda.is_available()
        use_quant = quantize and use_cuda

        if use_quant:
            from transformers import BitsAndBytesConfig

            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )
            logger.info(f"Loading model (4-bit NF4): {model_name} ...")
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_name,
                quantization_config=quant_config,
                device_map="auto",
                attn_implementation="sdpa",
            )
        elif use_cuda:
            logger.info(f"Loading model (fp16): {model_name} ...")
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_name,
                torch_dtype=torch.float16,
                device_map="auto",
                attn_implementation="sdpa",
            )
        else:
            logger.info(f"Loading model (fp32 CPU): {model_name} ...")
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_name,
                torch_dtype=torch.float32,
                device_map="cpu",
            )
        self._processor = AutoProcessor.from_pretrained(model_name)

        if use_cuda:
            mem = torch.cuda.memory_allocated() / 1024**3
            logger.info(f"Model loaded on {self.device}, VRAM: {mem:.2f} GB")
        else:
            logger.info(f"Model loaded on {self.device}")

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

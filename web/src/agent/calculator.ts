/**
 * 安全的四则运算求值器，不使用 eval。
 * 支持 + - * / 、括号和一元负号，使用调度场算法（shunting-yard）。
 */
export function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression)
  const output: (number | string)[] = []
  const operators: string[] = []

  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, 'u': 3 }

  for (const token of tokens) {
    if (typeof token === 'number') {
      output.push(token)
    } else if (token === '(') {
      operators.push(token)
    } else if (token === ')') {
      while (operators.length > 0 && operators[operators.length - 1] !== '(') {
        output.push(operators.pop()!)
      }
      operators.pop()
    } else {
      while (
        operators.length > 0 &&
        operators[operators.length - 1] !== '(' &&
        precedence[operators[operators.length - 1]] >= precedence[token]
      ) {
        output.push(operators.pop()!)
      }
      operators.push(token)
    }
  }

  while (operators.length > 0) {
    output.push(operators.pop()!)
  }

  return evaluateRPN(output)
}

function evaluateRPN(rpn: (number | string)[]): number {
  const stack: number[] = []
  for (const token of rpn) {
    if (typeof token === 'number') {
      stack.push(token)
    } else if (token === 'u') {
      const a = stack.pop()
      if (a === undefined) throw new Error('Invalid expression')
      stack.push(-a)
    } else {
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) throw new Error('Invalid expression')
      switch (token) {
        case '+': stack.push(a + b); break
        case '-': stack.push(a - b); break
        case '*': stack.push(a * b); break
        case '/':
          if (b === 0) throw new Error('除数不能为零')
          stack.push(a / b)
          break
      }
    }
  }
  if (stack.length !== 1) throw new Error('Invalid expression')
  return stack[0]
}

function tokenize(expression: string): (number | string)[] {
  const tokens: (number | string)[] = []
  let current = ''
  const cleaned = expression.replace(/\s/g, '')

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]
    if (/[0-9.]/.test(char)) {
      current += char
    } else {
      if (current) {
        tokens.push(Number.parseFloat(current))
        current = ''
      }
      // 一元负号：出现在开头、左括号后、或另一个运算符后
      if (char === '-' && (tokens.length === 0 ||
          tokens[tokens.length - 1] === '(' ||
          typeof tokens[tokens.length - 1] === 'string')) {
        tokens.push('u')
      } else if (char === '+' && (tokens.length === 0 ||
          tokens[tokens.length - 1] === '(' ||
          typeof tokens[tokens.length - 1] === 'string')) {
        // 一元正号，直接忽略
      } else {
        tokens.push(char)
      }
    }
  }

  if (current) {
    tokens.push(Number.parseFloat(current))
  }

  return tokens
}

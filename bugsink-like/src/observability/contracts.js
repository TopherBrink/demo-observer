/**
 * Слой 2 — контракт с бэкендом, проверяемый в рантайме. Гвоздь доклада.
 *
 * Идея: граница «данные с сервера → состояние приложения» — единственное место,
 * где рассогласование можно поймать в момент возникновения, а не через три
 * экрана, когда в корзине уже нарисовалось NaN.
 *
 * Два режима:
 *  - report  — сообщить и пропустить данные как есть (баг остаётся, но виден);
 *  - coerce  — сообщить и привести к ожидаемому типу (баг тушится на лету).
 *
 * Второй режим на докладе стоит показать с оговоркой: это лейкопластырь.
 * Чинить надо контракт, а не симптом. Но в проде он спасает релиз.
 */
import { z } from 'zod'
import { flags } from './flags'
import { capture } from './transport'
import { truncate } from './session'

/** Схема «как есть»: то, что фронтенд реально ожидает. */
export const ProductStrict = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number(),
  discount: z.number(),
  stock: z.number(),
  sale: z.boolean().optional(),
})

/** Схема-«терпилка»: то же самое, но переживает строки и null. */
export const ProductLenient = z.object({
  id: z.coerce.number(),
  title: z.string(),
  price: z.coerce.number(),
  discount: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => (v == null || v === '' ? 0 : Number(v))),
  stock: z.coerce.number().catch(0),
  sale: z.boolean().optional(),
})

export const ProductsStrict = z.array(ProductStrict)
export const ProductsLenient = z.array(ProductLenient)

/**
 * @param {import('zod').ZodTypeAny} strict   схема ожиданий
 * @param {import('zod').ZodTypeAny} lenient  схема восстановления (может быть null)
 * @param {unknown} data                      то, что пришло
 * @param {{ endpoint: string, traceId?: string }} ctx
 */
export function validate(strict, lenient, data, ctx) {
  if (!flags.contracts) return { ok: true, data, issues: [] }

  const result = strict.safeParse(data)
  if (result.success) return { ok: true, data: result.data, issues: [] }

  const issues = result.error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    code: issue.code,
    expected: issue.expected ?? null,
    received: issue.received ?? null,
    message: issue.message,
    // Самое ценное поле: что реально лежало по этому пути
    actual: truncate(safeStringify(valueAt(data, issue.path)), 200),
  }))

  capture(
    'contract',
    {
      endpoint: ctx.endpoint,
      traceId: ctx.traceId || null,
      issues,
      // Сырой ответ целиком (обрезанный и вычищенный) — без него разбирать нечего
      raw: truncate(safeStringify(data)),
      repaired: Boolean(flags.contractsCoerce && lenient),
    },
    {
      level: 'warning',
      // Группируем по набору полей, а не по значениям: иначе тысяча одинаковых issue
      fingerprint: `contract:${ctx.endpoint}:${issues.map((i) => `${i.path}/${i.code}`).join(',')}`,
    },
  )

  if (flags.contractsCoerce && lenient) {
    const repaired = lenient.safeParse(data)
    if (repaired.success) return { ok: false, data: repaired.data, issues, repaired: true }
  }

  return { ok: false, data, issues, repaired: false }
}

function valueAt(root, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), root)
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

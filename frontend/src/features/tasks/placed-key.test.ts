import { makeTask } from '@/test/render-app'

import { placedKey } from './api'

const a = makeTask({ id: 'a', title: 'a', sort_key: 'a0' })
const b = makeTask({ id: 'b', title: 'b', sort_key: 'a1', status: 'in_progress' })
const c = makeTask({ id: 'c', title: 'c', sort_key: 'a2' })
const x = makeTask({ id: 'x', title: 'x', sort_key: 'a3' })
// 整个列表（按 key 排列）；看板上 b 在「进行中」，其他在「待办」
const list = [a, b, c, x]

test('已经在前后两个之间就不改 key', () => {
  expect(placedKey(b, a, c, list)).toBe('a1')
  expect(placedKey(x, null, undefined, list)).toBe('a3')
})

test('紧挨着前一个放：看的是整个列表，不会和另一列的任务撞 key', () => {
  // 「待办」里把 x 放到 a 和 c 之间：a 后面紧挨着的是另一列的 b
  const key = placedKey(x, a, c, list)!
  expect(key > 'a0' && key < 'a1').toBe(true)
})

test('放到一列最前面：紧挨着后一个放', () => {
  // 「进行中」里把 x 放到 c 的前面（假设 c 在那一列）：c 前面紧挨着的是 b
  const key = placedKey(x, null, c, list)!
  expect(key > 'a1' && key < 'a2').toBe(true)
})

test('还没保存好的新任务不作为参照', () => {
  const pending = makeTask({ id: 'temp-1', title: 'temp-1', sort_key: '~' })
  const key = placedKey(a, x, undefined, [a, b, c, x, pending])!
  expect(key > 'a3' && key < '~').toBe(true)
})

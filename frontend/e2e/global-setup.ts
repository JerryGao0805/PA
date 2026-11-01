import { spawn } from 'node:child_process'

/** 启动邮件 worker（它不监听端口，没法用 webServer 管理），测试结束后关闭 */
export default async function globalSetup() {
  const worker = spawn('uv', ['--directory', '../backend', 'run', 'python', '-m', 'app.worker'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not start in 30s')), 30_000)
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('worker started')) {
        clearTimeout(timer)
        resolve()
      }
    }
    worker.stdout.on('data', onData)
    worker.stderr.on('data', onData) // logging 默认输出到 stderr
    worker.on('exit', (code) => reject(new Error(`worker exited early (code ${code})`)))
  })
  return () => {
    worker.kill('SIGTERM')
  }
}

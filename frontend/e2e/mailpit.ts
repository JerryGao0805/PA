import { expect } from '@playwright/test'

const MAILPIT = 'http://localhost:8026/api/v1'

interface MailpitMessage {
  ID: string
  Subject: string
}

/** 等待发给 to 的、标题包含 subject 的邮件，返回邮件里的应用链接 */
export async function waitForEmailLink(to: string, subject: string): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`)
        const res = await fetch(`${MAILPIT}/search?query=${query}`)
        const { messages } = (await res.json()) as { messages: MailpitMessage[] }
        if (!messages.length) return false
        const msg = (await (await fetch(`${MAILPIT}/message/${messages[0].ID}`)).json()) as {
          Text: string
        }
        link = /(http:\/\/localhost:\d+\/\S+#token=[\w-]+)/.exec(msg.Text)?.[1] ?? ''
        return link !== ''
      },
      { message: `waiting for "${subject}" email to ${to}`, timeout: 15_000 },
    )
    .toBe(true)
  return link
}

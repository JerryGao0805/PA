import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { meQuery } from '@/features/auth/api'
import { labelsQuery } from '@/features/labels/api'
import { projectsQuery, type Project } from '@/features/projects/api'
import type { NewTask } from '@/features/tasks/api'
import { nowIn } from '@/lib/dates'

import { parseTask, tokenKey, type ParsedTask, type Token } from './parse'

/**
 * 添加任务输入框的状态：输入的文字、取消识别的片段，以及解析结果。
 * allowProject 为 false 时不识别 #项目（子任务总是在父任务的项目里）
 */
export function useTaskInput({ allowProject = true } = {}) {
  const { t } = useTranslation()
  const { data: user } = useSuspenseQuery(meQuery)
  const { data: allProjects } = useSuspenseQuery(projectsQuery)
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const [text, setText] = useState('')
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set())

  // 收件箱用界面上的名字
  const named = useMemo<Project[]>(
    () => allProjects.map((p) => (p.is_inbox ? { ...p, name: t('nav.inbox') } : p)),
    [allProjects, t],
  )
  // 可以用 # 指定的项目：未归档的
  const projects = useMemo(
    () => (allowProject ? named.filter((p) => !p.archived) : []),
    [allowProject, named],
  )
  const timeZone = user?.timezone ?? 'UTC'
  const parsed = useMemo(
    () => parseTask(text, { now: nowIn(timeZone), projects, labels, ignored }),
    [text, timeZone, projects, labels, ignored],
  )

  return {
    text,
    setText,
    parsed,
    projects,
    labels,
    /** 按 id 找项目（归档的也算），名字和界面上的一样 */
    projectById: (id: string) => named.find((p) => p.id === id),
    /** 取消识别这一段，让它留在任务名称里 */
    ignore: (token: Token) => setIgnored((prev) => new Set(prev).add(tokenKey(token))),
    /** 提交后清空 */
    reset: () => {
      setText('')
      setIgnored(new Set())
    },
  }
}

export type TaskInputState = ReturnType<typeof useTaskInput>

/** 页面上的默认值加上识别出来的内容（识别出来的优先；标签合并） */
export function taskFromInput(defaults: Omit<NewTask, 'title'>, parsed: ParsedTask): NewTask {
  const task: NewTask = { ...defaults, title: parsed.title }
  if (parsed.projectId && !defaults.parent_id) task.project_id = parsed.projectId
  if (parsed.due) Object.assign(task, parsed.due)
  if (parsed.priority) task.priority = parsed.priority
  if (parsed.labelIds.length > 0) {
    task.label_ids = [...new Set([...(defaults.label_ids ?? []), ...parsed.labelIds])]
  }
  return task
}

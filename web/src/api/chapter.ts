import { api } from './client'
import type { Chapter } from '../types'

/** 获取章节完整内容（列表接口不含正文） */
export const apiGetChapter = (id: string) => api<Chapter>(`/api/chapters/${id}`)

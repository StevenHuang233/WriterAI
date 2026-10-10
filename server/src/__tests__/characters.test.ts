import { describe, expect, it } from 'vitest'
import { parseDetectedCharacters, parseFilledCharacter, parseRelations } from '../services/characters.js'

const SAMPLE = `【人物】林墨
【别名】林少侠、墨哥
【身份】主角，追查旧案的剑客
【外貌】黑衣，腰间一柄旧剑
【性格】沉默寡言
【动机】查清三年前官银失踪
【口头禅】
【备注】听雨剑原主人的后人

【人物】掌柜
【别名】酒馆老板
【身份】当年押送官银的护卫
【外貌】半张脸隐在暗处
【性格】谨慎
【动机】隐瞒往事
【口头禅】
【备注】兄长死于三年前`

describe('人物识别解析', () => {
  it('解析多个人物块', () => {
    const r = parseDetectedCharacters(SAMPLE)
    expect(r.length).toBe(2)
    expect(r[0]!.name).toBe('林墨')
    expect(r[1]!.name).toBe('掌柜')
  })

  it('解析别名与各项字段', () => {
    const r = parseDetectedCharacters(SAMPLE)
    expect(r[0]!.aliases).toEqual(['林少侠', '墨哥'])
    expect(r[0]!.role).toContain('剑客')
    expect(r[0]!.appearance).toContain('黑衣')
    expect(r[0]!.motivation).toContain('官银')
    expect(r[0]!.note).toContain('听雨剑')
    // 留空的字段为空串
    expect(r[0]!.catchphrase).toBe('')
  })

  it('兼容「人物：」写法与多余空行', () => {
    const raw = `人物：阿枝\n【身份】哑女童\n【备注】火灾唯一活口`
    const r = parseDetectedCharacters(raw)
    expect(r.length).toBe(1)
    expect(r[0]!.name).toBe('阿枝')
    expect(r[0]!.role).toBe('哑女童')
  })

  it('模型返回空或胡言时返回空数组', () => {
    expect(parseDetectedCharacters('')).toEqual([])
    expect(parseDetectedCharacters('抱歉，我无法完成')).toEqual([])
  })
})

describe('人物设定补全解析', () => {
  it('解析各字段', () => {
    const r = parseFilledCharacter(`【性别】男
【年龄】二十七
【身份】剑客
【外貌】黑衣
【性格】沉默
【动机】查案
【口头禅】
【设定】林墨自幼随师习剑，三年前师门遭变。`)
    expect(r.gender).toBe('男')
    expect(r.age).toBe('二十七')
    expect(r.role).toBe('剑客')
    expect(r.content).toContain('师门遭变')
  })
})

describe('人物关系解析', () => {
  it('解析每行一条的关系', () => {
    const r = parseRelations(`林墨｜旧识，互有戒备
掌柜｜当年押银护卫
（以下不属于关系）`)
    expect(r.length).toBe(2)
    expect(r[0]).toEqual({ name: '林墨', label: '旧识，互有戒备' })
  })

  it('半角竖线也能解析', () => {
    expect(parseRelations('阿枝|被救下的哑女童')).toEqual([{ name: '阿枝', label: '被救下的哑女童' }])
  })
})

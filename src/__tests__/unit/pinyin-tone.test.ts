import { describe, expect, it } from 'vitest';
import { applyToneNumber, convertToneNumbers } from '@/lib/pinyin-tone';

describe('applyToneNumber', () => {
  it.each([
    ['ma3', 'mǎ'],
    ['lv4', 'lǜ'],
    ['nü3', 'nǚ'],
    ['nv3', 'nǚ'],
    ['zhuang1', 'zhuāng'],
    ['gui4', 'guì'],
    ['liu2', 'liú'],
    ['er2', 'ér'],
    ['jue2', 'jué'],
    ['lve4', 'lüè'],
    ['de5', 'de'],
    ['ma0', 'ma'],
    ['MA3', 'MǍ'],
    ['Ma3', 'Mǎ'],
    ['LV4', 'LǛ'],
  ])('%s → %s', (input, expected) => {
    expect(applyToneNumber(input)).toBe(expected);
  });

  it('没有尾部数字或不是合法拼音音节时原样返回', () => {
    expect(applyToneNumber('ma')).toBe('ma');
    expect(applyToneNumber('code1')).toBe('code1');
    expect(applyToneNumber('mǎ3')).toBe('mǎ3');
    expect(applyToneNumber('')).toBe('');
  });
});

describe('convertToneNumbers', () => {
  it('转换文本中的拼音音节，保留其他内容', () => {
    expect(convertToneNumbers('看拼音写词语：ma3，lv4，nü3。'))
      .toBe('看拼音写词语：mǎ，lǜ，nǚ。');
    expect(convertToneNumbers('zhuang1 gui4 liu2 er2'))
      .toBe('zhuāng guì liú ér');
  });

  it('连写拼音的每个音节都转换', () => {
    expect(convertToneNumbers('ni3hao3')).toBe('nǐhǎo');
    expect(convertToneNumbers('Zhong1guo2')).toBe('Zhōngguó');
    expect(convertToneNumbers('lv4se4')).toBe('lǜsè');
    expect(convertToneNumbers('xie4xie5')).toBe('xièxie');
    expect(convertToneNumbers('中文中夹带 ni3hao3，继续')).toBe('中文中夹带 nǐhǎo，继续');
  });

  it('已带声调符号的拼音保持不变', () => {
    expect(convertToneNumbers('zhāo（朝） mǎ（马）')).toBe('zhāo（朝） mǎ（马）');
  });

  it('不误转英文单词后的数字', () => {
    expect(convertToneNumbers('code1 test2 abc3 mp3 pdf2 usb3 data1 api1 code12 test2go hello1'))
      .toBe('code1 test2 abc3 mp3 pdf2 usb3 data1 api1 code12 test2go hello1');
  });

  it('数字后紧跟数字时不截断，紧跟字母视为下一个音节', () => {
    expect(convertToneNumbers('ma33')).toBe('ma33');
    expect(convertToneNumbers('ma3abc')).toBe('mǎabc');
  });

  it('5 和 0 只去掉数字，大小写保持', () => {
    expect(convertToneNumbers('de5 ma0 MA3')).toBe('de ma MǍ');
  });

  it('空串与不含数字声调的文本原样返回', () => {
    expect(convertToneNumbers('')).toBe('');
    expect(convertToneNumbers('ma 3 数学 123')).toBe('ma 3 数学 123');
  });
});

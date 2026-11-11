/**
 * 拼音数字声调转换的纯函数（前后端共用，不依赖服务端模块）
 *
 * 输入写法如 ma3、lv4、nü3；输出带调符号如 mǎ、lǜ、nǚ。
 * 标调规则：有 a/e 标 a/e，ou 标 o，否则标最后一个元音（iu 标 u、ui 标 i）。
 * v 一律视为 ü。5 和 0 表示轻声，只去掉数字。
 */

/** 各元音在 1~4 声下的带调字符；键同时包含大小写，以保持输入的大小写 */
const TONE_MARKS: Record<string, readonly string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  A: ['Ā', 'Á', 'Ǎ', 'À'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  O: ['Ō', 'Ó', 'Ǒ', 'Ò'],
  e: ['ē', 'é', 'ě', 'è'],
  E: ['Ē', 'É', 'Ě', 'È'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  I: ['Ī', 'Í', 'Ǐ', 'Ì'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  U: ['Ū', 'Ú', 'Ǔ', 'Ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  Ü: ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ'],
};

/**
 * 常用拼音音节表（不含声调），用于区分拼音与英文单词 + 数字。
 * 取舍：优先避免把 code1、test2 这类英文误转；单字母音节（a/o/e）和
 * 恰好与英文单词同形的拼音（he、me 等）仍会按拼音转换。
 */
const PINYIN_SYLLABLE_TABLE = `
a ai an ang ao
ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
da dai dan dang dao de dei deng di dia dian diao die ding diu dong dou du duan dui dun duo
e ei en eng er
fa fan fang fei fen feng fo fou fu
ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe
ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nü nüe
o ou
pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo
sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo
ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
wa wai wan wang wei wen weng wo wu
xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo
`.trim().split(/\s+/);

const PINYIN_SYLLABLES = new Set(PINYIN_SYLLABLE_TABLE);

/** 找到该音节应标声调的元音位置；ou 单独处理，iu/ui 由「最后一个元音」覆盖 */
function toneVowelIndex(lower: string): number {
  const a = lower.indexOf('a');
  if (a >= 0) return a;
  const e = lower.indexOf('e');
  if (e >= 0) return e;
  if (lower.includes('ou')) return lower.indexOf('o');
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    if ('aeiouü'.includes(lower[index])) return index;
  }
  return -1;
}

/**
 * 把带数字声调的单个拼音音节转成带调符号。
 * 输入没有尾部数字或不是合法拼音音节时原样返回。
 */
export function applyToneNumber(syllable: string): string {
  const match = /^([A-Za-züÜ]+)([0-5])$/.exec(syllable);
  if (!match) return syllable;

  const base = match[1].replace(/v/g, 'ü').replace(/V/g, 'Ü');
  if (!PINYIN_SYLLABLES.has(base.toLowerCase())) return syllable;

  const tone = Number(match[2]);
  if (tone === 0 || tone === 5) return base;

  const position = toneVowelIndex(base.toLowerCase());
  if (position < 0) return syllable;

  const marks = TONE_MARKS[base[position]];
  if (!marks) return syllable;
  return base.slice(0, position) + marks[tone - 1] + base.slice(position + 1);
}

/**
 * 把文本中所有「拼音字母 + 数字 1~5」的音节转换为带调符号，其余内容不动。
 * 音节前不能紧接字母，避免从英文单词中间截取；数字后不能紧跟数字。
 * 数字后紧接字母视为下一个连写音节，因此 ni3hao3 会同时转换两个音节；
 * 音节本身再用合法音节表校验，code12、test2go、hello1 等英文不会转换。
 */
export function convertToneNumbers(text: string): string {
  return text.replace(/(?<![A-Za-züÜ])[A-Za-züÜ]+[0-5](?![0-9])/g, (candidate) => applyToneNumber(candidate));
}

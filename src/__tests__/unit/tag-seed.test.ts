// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { seedStandardSubject } from '@/lib/tags/seed';

/** 构造一个最小可用的 TransactionClient mock，记录 create 调用 */
function createTxMock() {
    const created: Array<Record<string, unknown>> = [];
    let autoId = 0;
    const tx = {
        knowledgeTag: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                autoId++;
                const record = { id: `tag-${autoId}`, ...data };
                created.push(record);
                return record;
            },
        },
    };
    return { tx, created };
}

describe('seedStandardSubject', () => {
    it('按年级→章→知识点三层创建层级结构', async () => {
        const { tx, created } = createTxMock();
        const curriculum = {
            '七年级上': [
                { chapter: '第一章 有理数', tags: ['正数', '负数', '有理数'] },
                { chapter: '第二章 整式', tags: ['单项式'] },
            ],
            '七年级下': [
                { chapter: '第三章 方程', tags: ['一元一次方程'] },
            ],
        };
        const gradeOrder: Record<string, number> = { '七年级上': 1, '七年级下': 2 };

        const count = await seedStandardSubject(tx as never, 'math', curriculum, gradeOrder);

        // 2 年级 + 3 章 + 5 知识点 = 10
        expect(count).toBe(10);
        expect(created).toHaveLength(10);

        const [grade1, ch1, leaf1, leaf2, leaf3, ch2, leaf4, grade2, ch3, leaf5] = created;

        // 年级节点
        expect(grade1).toMatchObject({ name: '七年级上', subject: 'math', parentId: null, isSystem: true, order: 1 });
        expect(grade2).toMatchObject({ name: '七年级下', subject: 'math', parentId: null, isSystem: true, order: 2 });

        // 章节节点
        expect(ch1).toMatchObject({ name: '第一章 有理数', subject: 'math', parentId: grade1.id, isSystem: true, order: 1 });
        expect(ch2).toMatchObject({ name: '第二章 整式', subject: 'math', parentId: grade1.id, isSystem: true, order: 2 });
        expect(ch3).toMatchObject({ name: '第三章 方程', subject: 'math', parentId: grade2.id, isSystem: true, order: 1 });

        // 叶子知识点
        expect(leaf1).toMatchObject({ name: '正数', subject: 'math', parentId: ch1.id, isSystem: true, order: 1 });
        expect(leaf2).toMatchObject({ name: '负数', subject: 'math', parentId: ch1.id, isSystem: true, order: 2 });
        expect(leaf3).toMatchObject({ name: '有理数', subject: 'math', parentId: ch1.id, isSystem: true, order: 3 });
        expect(leaf4).toMatchObject({ name: '单项式', subject: 'math', parentId: ch2.id, isSystem: true, order: 1 });
        expect(leaf5).toMatchObject({ name: '一元一次方程', subject: 'math', parentId: ch3.id, isSystem: true, order: 1 });
    });

    it('gradeOrder 中未列出的年级使用默认 order 99', async () => {
        const { tx, created } = createTxMock();
        const curriculum = {
            '未知年级': [{ chapter: '第一章', tags: ['知识点A'] }],
        };
        const gradeOrder: Record<string, number> = {};

        const count = await seedStandardSubject(tx as never, 'physics', curriculum, gradeOrder);

        expect(count).toBe(3);
        expect(created[0]).toMatchObject({ name: '未知年级', order: 99 });
    });

    it('空课程返回 0，不创建任何标签', async () => {
        const { tx, created } = createTxMock();
        const count = await seedStandardSubject(tx as never, 'english', {}, {});
        expect(count).toBe(0);
        expect(created).toHaveLength(0);
    });
});

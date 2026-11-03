"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { COLORS } from "./chart-colors";

export interface SubjectPieChartProps {
    title: string;
    data: Array<{ name: string; value: number }>;
}

/** 学科分布环形饼图卡片，图例以 HTML 渲染在图表下方，避免窄屏裁剪 */
export function SubjectPieChart({ title, data }: SubjectPieChartProps) {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={70}
                                fill={COLORS[0]}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                {/* HTML 图例：色块 + 名称 + 数量 + 百分比，自动换行 */}
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {data.map((item, index) => {
                        const percent = total > 0 ? ((item.value / total) * 100).toFixed(0) : "0";
                        return (
                            <li key={item.name} className="flex items-center gap-1.5">
                                <span
                                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <span className="text-muted-foreground">
                                    {item.name} {item.value} ({percent}%)
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
}

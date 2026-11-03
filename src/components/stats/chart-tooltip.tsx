"use client";

/** recharts 传给自定义提示框的参数（只列出用到的字段） */
export interface ChartTooltipProps {
    active?: boolean;
    payload?: Array<{ name?: string | number; value?: string | number; color?: string }>;
    label?: string | number;
}

interface ChartTooltipConfig {
    /** 合计行文案，不传则不显示合计 */
    totalLabel?: string;
}

/**
 * 通用 recharts 自定义提示框。
 * 显示 label + 每项的色点、名称和值，可选显示数值合计。
 */
export function ChartTooltip(
    { active, payload, label, totalLabel }: ChartTooltipProps & ChartTooltipConfig,
) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
                <p className="font-medium mb-2">{label}</p>
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center gap-2 mb-1 last:mb-0">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">
                            {entry.name}:
                        </span>
                        <span className="font-medium">
                            {entry.value}
                        </span>
                    </div>
                ))}
                {totalLabel !== undefined && (
                    <div className="mt-2 pt-2 border-t flex justify-between gap-4">
                        <span className="text-muted-foreground">{totalLabel}:</span>
                        <span className="font-bold">
                            {payload.reduce((acc, curr) => acc + (typeof curr.value === 'number' ? curr.value : 0), 0)}
                        </span>
                    </div>
                )}
            </div>
        );
    }
    return null;
}

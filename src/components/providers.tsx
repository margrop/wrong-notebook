"use client";

import { useEffect } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TimeZoneProvider } from "@/contexts/TimeZoneContext";
import { AiConsentDialog } from "@/components/ai-consent-dialog";
import { AppShell } from "@/components/app-shell";
import { BackgroundTasksButton } from "@/components/background-tasks-button";
import { FeedbackHost } from "@/components/ui/feedback-host";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { installGlobalErrorLogging } from "@/lib/frontend-logger";

export function Providers({ children, timeZone }: { children: React.ReactNode; timeZone?: string }) {
    // 未捕获的前端异常上报到服务端日志，调试模式下可随调试日志导出
    useEffect(() => installGlobalErrorLogging(), []);

    return (
        <SessionProvider>
            <ThemeProvider>
                <LanguageProvider>
                    <TimeZoneProvider initialTimeZone={timeZone}>
                        <AppShell>{children}</AppShell>
                        <BackgroundTasksButton />
                        <AiConsentDialog />
                        <FeedbackHost />
                        <ServiceWorkerRegister />
                    </TimeZoneProvider>
                </LanguageProvider>
            </ThemeProvider>
        </SessionProvider>
    );
}

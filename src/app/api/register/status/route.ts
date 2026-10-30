import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { isInitialized } from "@/lib/initialization";

/** 登录、注册页使用：是否开放注册，以及是否已创建管理员（未创建时登录页提示使用初始化链接） */
export async function GET() {
    const config = getAppConfig();
    return NextResponse.json({
        allowRegistration: config.allowRegistration === true,
        initialized: await isInitialized(),
    });
}

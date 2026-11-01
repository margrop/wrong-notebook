import { test } from './support/fixtures';
import { importImage, viewports } from './support/flows';

for (const profile of viewports) {
    test.describe(profile.name, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });
        test('[E2E-M01] 免校对图片导入经过真实模型适配器并持久化', async ({ page, scenario }) => {
            await importImage(page, scenario, false);
        });
    });
}

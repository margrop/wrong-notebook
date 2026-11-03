#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const MOCK_OPENCLAW_PORT = 8080;
const WRONG_NOTEBOOK_PORT = 3000;
const API_KEY = 'test-api-key-12345';

const mockImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/recognize') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            console.log(`[Mock Openclaw] Received request:`, JSON.stringify(body.substring(0, 100)));

            setTimeout(() => {
                const response = {
                    success: true,
                    data: {
                        questionText: '已知函数 f(x) = x² + 2x + 1，求 f(3) 的值。',
                        answerText: 'f(3) = 3² + 2×3 + 1 = 9 + 6 + 1 = 16',
                        analysis: '这是一个关于函数求值的题目。首先将 x=3 代入函数表达式，然后进行计算。',
                        knowledgePoints: ['函数', '代数代入', '平方运算'],
                        subject: '数学',
                        errorType: '计算错误',
                        source: '期末考试'
                    }
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
            }, 100);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(MOCK_OPENCLAW_PORT, () => {
    console.log(`Mock Openclaw server running on port ${MOCK_OPENCLAW_PORT}`);
});

const testScript = `
#!/bin/bash

# 测试脚本 - Openclaw 集成接口

BASE_URL="http://localhost:${WRONG_NOTEBOOK_PORT}"
API_KEY="${API_KEY}"

echo "========================================="
echo "Openclaw 批量上传接口测试"
echo "========================================="
echo ""

# 测试1: 无API密钥
echo "测试1: 无API密钥 (应返回401)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -d '{"userEmail": "admin@localhost", "images": []}'
echo ""
echo "-----------------------------------------"
echo ""

# 测试2: 无效API密钥
echo "测试2: 无效API密钥 (应返回401)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: wrong-key" \\
  -d '{"userEmail": "admin@localhost", "images": []}'
echo ""
echo "-----------------------------------------"
echo ""

# 测试3: 空图片数组
echo "测试3: 空图片数组 (应返回400)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $API_KEY" \\
  -d '{"userEmail": "admin@localhost", "images": []}'
echo ""
echo "-----------------------------------------"
echo ""

# 测试4: 图片数量超限
echo "测试4: 图片数量超限 (应返回400)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $API_KEY" \\
  -d "{\\"userEmail\\": \\"admin@localhost\\", \\"images\\": [$(printf '{ "base64": "abc", "mimeType": "image/jpeg", "filename": "test.jpg" },' 21 | head -c 500)]}"
echo ""
echo "-----------------------------------------"
echo ""

# 测试5: 用户不存在
echo "测试5: 用户不存在 (应返回404)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $API_KEY" \\
  -d '{"userEmail": "nonexistent@example.com", "images": [{"base64": "abc", "mimeType": "image/jpeg", "filename": "test.jpg"}]}'
echo ""
echo "-----------------------------------------"
echo ""

# 准备测试图片 (base64)
TEST_IMAGE=$(base64 -i src/__tests__/fixtures/images/math_test.png 2>/dev/null || echo "")
if [ -z "$TEST_IMAGE" ]; then
    echo "使用内置测试图片..."
    # 创建一个简单的1x1像素PNG图片的base64
    TEST_IMAGE="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABkJgggJRU5Er=="
fi

# 测试6: 成功上传单张图片
echo "测试6: 成功上传单张图片 (应返回201)"
curl -s -X POST "$BASE_URL/api/openclaw/batch-upload" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $API_KEY" \\
  -d "{\\"userEmail\\": \\"admin@localhost\\", \\"images\\": [{\\"base64\\": \\"$TEST_IMAGE\\", \\"mimeType\\": \\"image/png\\", \\"filename\\": \\"test.png\\"}]}"
echo ""
echo "-----------------------------------------"
echo ""

echo "测试完成!"
`;

const testFilePath = path.join(__dirname, 'test-openclaw.sh');
fs.writeFileSync(testFilePath, testScript);
console.log(`Test script created: ${testFilePath}`);

console.log('\nNow please:');
console.log('1. 确保 wrong-notebook 服务运行在端口 3000');
console.log('2. 在 .env 文件中添加以下配置:');
console.log(`   OPENCLAW_API_URL=http://localhost:${MOCK_OPENCLAW_PORT}`);
console.log(`   OPENCLAW_INTEGRATION_API_KEY=${API_KEY}`);
console.log('3. 初始化数据库: npx prisma db seed');
console.log('4. 运行测试: bash test-openclaw.sh');

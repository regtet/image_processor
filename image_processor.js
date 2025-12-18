/**
 * 图片批量处理器
 * 处理指定目录下的所有子文件夹
 * 步骤1: 在 to.imagestool.com 转换为 AVIF 格式
 * 步骤2: 解压 ZIP，上传 AVIF 到 tiny.imagestool.com 压缩
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.avif'];

function getImages(folderPath) {
    const files = fs.readdirSync(folderPath);
    
    // 先在当前目录查找图片
    let images = files
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            const fullPath = path.join(folderPath, file);
            return SUPPORTED_FORMATS.includes(ext) && fs.statSync(fullPath).isFile();
        })
        .map(file => path.join(folderPath, file));
    
    // 如果当前目录没有图片，检查子文件夹（最多嵌套2层）
    if (images.length === 0) {
        const subfolders = files.filter(file => {
            const fullPath = path.join(folderPath, file);
            return fs.statSync(fullPath).isDirectory();
        });
        
        // 遍历子文件夹查找图片
        for (const subfolder of subfolders) {
            const subPath = path.join(folderPath, subfolder);
            const subFiles = fs.readdirSync(subPath);
            
            const subImages = subFiles
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    const fullPath = path.join(subPath, file);
                    return SUPPORTED_FORMATS.includes(ext) && fs.statSync(fullPath).isFile();
                })
                .map(file => path.join(subPath, file));
            
            if (subImages.length > 0) {
                console.log(`  [嵌套] 在子文件夹 "${subfolder}" 中找到图片`);
                images = subImages;
                break;  // 只处理第一个有图片的子文件夹
            }
        }
    }
    
    return images;
}

function getSubfolders(parentPath) {
    const items = fs.readdirSync(parentPath);
    // 忽略 _processed_output 文件夹（脚本输出目录）
    const ignoreFolders = ['_processed_output', 'node_modules', '.git'];
    return items
        .filter(item => {
            const fullPath = path.join(parentPath, item);
            return fs.statSync(fullPath).isDirectory() && !ignoreFolders.includes(item);
        })
        .map(item => path.join(parentPath, item));
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 使用 PowerShell 解压 ZIP 文件
 */
function unzipFile(zipPath, destDir) {
    console.log(`  [解压] 正在解压: ${path.basename(zipPath)}`);
    ensureDir(destDir);
    
    try {
        // 使用 PowerShell 解压
        const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
        execSync(cmd, { stdio: 'ignore' });
        console.log(`  [解压] 解压完成: ${destDir}`);
        return true;
    } catch (e) {
        console.log(`  [解压] 解压失败: ${e.message}`);
        return false;
    }
}

/**
 * 步骤1: 转换图片格式为 AVIF (带重试机制)
 */
async function convertImages(context, images, outputDir, retryCount = 0) {
    const maxRetries = 1;
    const page = await context.newPage();
    
    try {
        console.log('  [转换] 正在打开转换页面...');
        
        // 直接打开 AVIF 转换专用页面（无需选择格式）
        await page.goto('https://to.imagestool.com/zh-CN/image-to-avif', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        await sleep(3000);
        
        console.log(`  [转换] 正在上传 ${images.length} 张图片...`);
        const fileInput = page.locator('input[type="file"]:not([webkitdirectory])').first();
        await fileInput.setInputFiles(images);
        
        console.log('  [转换] 等待图片加载...');
        await sleep(5000);
        
        // 设置画质和压缩强度（滑块）
        console.log('  [转换] 设置参数: 画质100, 压缩强度1');
        try {
            // 画质滑块: max=100
            const qualitySlider = page.locator('input[type="range"][max="100"]').first();
            if (await qualitySlider.isVisible({ timeout: 3000 })) {
                await qualitySlider.evaluate((el) => {
                    el.value = 100;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
                console.log('  [转换] 画质已设置为 100');
            }
            
            // 压缩强度滑块: max=8
            const strengthSlider = page.locator('input[type="range"][max="8"]').first();
            if (await strengthSlider.isVisible({ timeout: 3000 })) {
                await strengthSlider.evaluate((el) => {
                    el.value = 1;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
                console.log('  [转换] 压缩强度已设置为 1');
            }
            
            await sleep(1000);
            console.log('  [转换] 参数设置完成');
        } catch (e) {
            console.log(`  [转换] 参数设置失败: ${e.message}`);
        }
        
        // 点击开始按钮 (class="button_start")
        try {
            const startBtn = page.locator('button.button_start').first();
            if (await startBtn.isVisible({ timeout: 5000 })) {
                console.log('  [转换] 点击开始按钮...');
                await startBtn.click();
            }
        } catch (e) {
            console.log('  [转换] 没有找到开始按钮，可能自动处理中...');
        }
        
        console.log('  [转换] 正在转换中，请等待所有图片完成...');
        
        // 等待处理完成 - 查找下载按钮出现（最多等5分钟）
        let downloadReady = false;
        for (let i = 0; i < 30; i++) {  // 最多等待 30 * 10秒 = 5分钟
            await sleep(10000);
            console.log(`  [转换] 等待中... (${(i+1)*10}秒)`);
            
            // 检查下载按钮是否出现
            try {
                const btn = page.locator('button:has-text("下载"), a:has-text("下载")').first();
                if (await btn.isVisible({ timeout: 2000 })) {
                    downloadReady = true;
                    console.log('  [转换] 处理完成，下载按钮已出现!');
                    break;
                }
            } catch (e) {}
        }
        
        if (!downloadReady) {
            console.log('  [转换] 等待超时，尝试查找下载按钮...');
        }
        
        await sleep(3000);
        console.log('  [转换] 正在查找下载按钮...');
        
        let downloadPath = null;
        
        // 精确定位下载按钮: 紫色按钮包含"下载 Zip"文字
        const downloadBtn = page.locator('button.bg-purple-500:has-text("下载 Zip"), button:has-text("下载 Zip")').first();
        
        if (await downloadBtn.isVisible({ timeout: 10000 })) {
            console.log('  [转换] 找到下载按钮，正在下载...');
            
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 120000 }),
                downloadBtn.click()
            ]);
            
            const filename = download.suggestedFilename();
            downloadPath = path.join(outputDir, 'converted_' + filename);
            await download.saveAs(downloadPath);
            console.log(`  [转换] 已保存: ${path.basename(downloadPath)}`);
        } else {
            throw new Error('未找到下载按钮，可能被广告遮挡');
        }
        
        await page.close();
        return downloadPath;
        
    } catch (e) {
        console.log(`  [转换] 失败: ${e.message}`);
        await page.close();
        
        // 重试机制
        if (retryCount < maxRetries) {
            console.log(`  [转换] 正在重试... (${retryCount + 1}/${maxRetries})`);
            await sleep(2000);
            return convertImages(context, images, outputDir, retryCount + 1);
        } else {
            console.log('  [转换] 重试次数已用完，跳过转换步骤');
            return null;
        }
    }
}

/**
 * 步骤2: 压缩图片 (带重试机制)
 */
async function compressImages(context, images, outputDir, retryCount = 0) {
    const maxRetries = 1;
    const page = await context.newPage();
    
    try {
        console.log('  [压缩] 正在打开压缩页面...');
        
        await page.goto('https://tiny.imagestool.com/zh-CN/image-compressor', {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        await sleep(3000);
        
        console.log(`  [压缩] 正在上传 ${images.length} 张图片...`);
        const fileInput = page.locator('input[type="file"]:not([webkitdirectory])').first();
        await fileInput.setInputFiles(images);
        
        console.log('  [压缩] 等待图片加载...');
        await sleep(5000);
        
        // 点击开始按钮 (class="button_start")
        try {
            const startBtn = page.locator('button.button_start').first();
            if (await startBtn.isVisible({ timeout: 5000 })) {
                console.log('  [压缩] 点击开始按钮...');
                await startBtn.click();
            }
        } catch (e) {
            console.log('  [压缩] 没有找到开始按钮，可能自动处理中...');
        }
        
        console.log('  [压缩] 正在压缩中，请等待所有图片完成...');
        
        // 等待处理完成 - 查找下载按钮出现（最多等5分钟）
        let downloadReady = false;
        for (let i = 0; i < 30; i++) {  // 最多等待 30 * 10秒 = 5分钟
            await sleep(10000);
            console.log(`  [压缩] 等待中... (${(i+1)*10}秒)`);
            
            // 检查下载按钮是否出现
            try {
                const btn = page.locator('button:has-text("下载"), a:has-text("下载")').first();
                if (await btn.isVisible({ timeout: 2000 })) {
                    downloadReady = true;
                    console.log('  [压缩] 处理完成，下载按钮已出现!');
                    break;
                }
            } catch (e) {}
        }
        
        if (!downloadReady) {
            console.log('  [压缩] 等待超时，尝试查找下载按钮...');
        }
        
        await sleep(3000);
        console.log('  [压缩] 正在查找下载按钮...');
        
        let downloadPath = null;
        
        // 精确定位下载按钮: 紫色按钮包含"下载 Zip"文字
        const downloadBtn = page.locator('button.bg-purple-500:has-text("下载 Zip"), button:has-text("下载 Zip")').first();
        
        if (await downloadBtn.isVisible({ timeout: 10000 })) {
            console.log('  [压缩] 找到下载按钮，正在下载...');
            
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 120000 }),
                downloadBtn.click()
            ]);
            
            const filename = download.suggestedFilename();
            downloadPath = path.join(outputDir, 'compressed_' + filename);
            await download.saveAs(downloadPath);
            console.log(`  [压缩] 已保存: ${path.basename(downloadPath)}`);
        } else {
            throw new Error('未找到下载按钮，可能被广告遮挡');
        }
        
        await page.close();
        return downloadPath;
        
    } catch (e) {
        console.log(`  [压缩] 失败: ${e.message}`);
        await page.close();
        
        // 重试机制
        if (retryCount < maxRetries) {
            console.log(`  [压缩] 正在重试... (${retryCount + 1}/${maxRetries})`);
            await sleep(2000);
            return compressImages(context, images, outputDir, retryCount + 1);
        } else {
            console.log('  [压缩] 重试次数已用完，跳过压缩步骤');
            return null;
        }
    }
}

/**
 * 处理单个文件夹
 */
async function processFolder(context, folderPath, outputDir) {
    const folderName = path.basename(folderPath);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`正在处理: ${folderName}`);
    console.log('='.repeat(50));
    
    const images = getImages(folderPath);
    if (images.length === 0) {
        console.log('  没有找到图片，跳过...');
        return;
    }
    
    console.log(`  找到 ${images.length} 张图片`);
    
    // 创建输出文件夹
    const folderOutput = path.join(outputDir, folderName);
    ensureDir(folderOutput);
    
    // 步骤1: 转换为 AVIF (带重试机制)
    console.log('\n  >>> 步骤1: 转换为 AVIF 格式');
    const convertedZip = await convertImages(context, images, folderOutput);
    
    // 步骤2: 处理转换后的文件（可能是zip或单个图片）
    let avifImages = [];
    if (convertedZip && fs.existsSync(convertedZip)) {
        const ext = path.extname(convertedZip).toLowerCase();
        const unzipDir = path.join(folderOutput, 'avif_temp');
        ensureDir(unzipDir);
        
        if (ext === '.zip') {
            // 是 ZIP 文件，需要解压
            if (unzipFile(convertedZip, unzipDir)) {
                avifImages = getImages(unzipDir);
                console.log(`  [解压] 找到 ${avifImages.length} 张 AVIF 图片`);
            }
        } else if (SUPPORTED_FORMATS.includes(ext) || ext === '.avif') {
            // 是单个图片文件（只有1张图时网站直接下载图片而不是zip）
            console.log(`  [转换] 单个图片文件，无需解压`);
            const newPath = path.join(unzipDir, path.basename(convertedZip).replace('converted_', ''));
            fs.copyFileSync(convertedZip, newPath);
            fs.unlinkSync(convertedZip);
            avifImages = [newPath];
            console.log(`  [转换] 图片已准备: ${path.basename(newPath)}`);
        }
    }
    
    // 步骤3: 压缩 AVIF 图片 (带重试机制)
    if (avifImages.length > 0) {
        console.log('\n  >>> 步骤2: 压缩 AVIF 图片');
        await compressImages(context, avifImages, folderOutput);
        
        // 清理临时目录
        const unzipDir = path.join(folderOutput, 'avif_temp');
        try {
            fs.rmSync(unzipDir, { recursive: true, force: true });
            console.log('  [清理] 已删除临时文件');
        } catch (e) {}
    } else {
        console.log('  [警告] 没有 AVIF 图片可压缩，使用原图压缩...');
        console.log('\n  >>> 步骤2: 压缩原图');
        await compressImages(context, images, folderOutput);
    }
    
    // 解压压缩后的ZIP，清理中间文件
    console.log('\n  >>> 步骤3: 解压最终文件并清理');
    try {
        const allFiles = fs.readdirSync(folderOutput);
        
        // 只解压 compressed 开头的 ZIP（最终压缩结果）
        const compressedZips = allFiles.filter(f => f.startsWith('compressed_') && f.endsWith('.zip'));
        for (const zipFile of compressedZips) {
            const zipPath = path.join(folderOutput, zipFile);
            // 解压到文件夹根目录
            if (unzipFile(zipPath, folderOutput)) {
                fs.unlinkSync(zipPath);
                console.log(`  [清理] 已解压并删除: ${zipFile}`);
            }
        }
        
        // 处理单个 compressed 图片文件（非zip）
        const compressedImages = allFiles.filter(f => f.startsWith('compressed_') && !f.endsWith('.zip'));
        for (const imgFile of compressedImages) {
            const oldPath = path.join(folderOutput, imgFile);
            const newName = imgFile.replace('compressed_', '');
            const newPath = path.join(folderOutput, newName);
            fs.renameSync(oldPath, newPath);
            console.log(`  [清理] 已重命名: ${imgFile} -> ${newName}`);
        }
        
        // 删除 converted 开头的文件（中间产物）
        const convertedFiles = allFiles.filter(f => f.startsWith('converted_'));
        for (const file of convertedFiles) {
            const filePath = path.join(folderOutput, file);
            fs.unlinkSync(filePath);
            console.log(`  [清理] 已删除中间文件: ${file}`);
        }
        
        // 删除 avif_temp 临时文件夹（如果还存在）
        const avifTempDir = path.join(folderOutput, 'avif_temp');
        if (fs.existsSync(avifTempDir)) {
            fs.rmSync(avifTempDir, { recursive: true, force: true });
            console.log('  [清理] 已删除临时文件夹: avif_temp');
        }
        
        // 如果解压后有嵌套文件夹，把文件移到根目录
        const remainingItems = fs.readdirSync(folderOutput);
        for (const item of remainingItems) {
            const itemPath = path.join(folderOutput, item);
            if (fs.statSync(itemPath).isDirectory()) {
                // 把子文件夹里的文件移到根目录
                const subFiles = fs.readdirSync(itemPath);
                for (const subFile of subFiles) {
                    const subFilePath = path.join(itemPath, subFile);
                    const destPath = path.join(folderOutput, subFile);
                    if (fs.statSync(subFilePath).isFile()) {
                        fs.renameSync(subFilePath, destPath);
                    }
                }
                // 删除空文件夹
                fs.rmSync(itemPath, { recursive: true, force: true });
                console.log(`  [清理] 已整理嵌套文件夹: ${item}`);
            }
        }
        
        console.log('  [清理] 清理完成，文件已整理到根目录');
    } catch (e) {
        console.log(`  [清理] 清理过程出错: ${e.message}`);
    }
    
    console.log(`\n  ✓ 完成! 输出目录: ${folderOutput}`);
}

async function main() {
    console.log('='.repeat(50));
    console.log('  图片批量处理器');
    console.log('  转换为 AVIF → 解压 → 压缩');
    console.log('='.repeat(50));
    
    // 默认使用 Downloads 文件夹
    const downloadsPath = 'C:\\Users\\18272\\Downloads';
    
    let parentFolder = process.argv[2];
    if (!parentFolder) {
        console.log(`\n默认文件夹: ${downloadsPath}`);
        const useDefault = await prompt('使用默认文件夹? (Y/n): ');
        if (useDefault.toLowerCase() === 'n') {
            parentFolder = await prompt('请输入文件夹路径: ');
        } else {
            parentFolder = downloadsPath;
        }
    }
    parentFolder = parentFolder.replace(/^["']|["']$/g, '');
    
    if (!fs.existsSync(parentFolder)) {
        console.log('[错误] 文件夹不存在: ' + parentFolder);
        await prompt('按回车键退出...');
        process.exit(1);
    }
    
    // 获取子文件夹
    const subfolders = getSubfolders(parentFolder);
    if (subfolders.length === 0) {
        console.log('[错误] 没有找到子文件夹');
        await prompt('按回车键退出...');
        process.exit(1);
    }
    
    console.log(`\n找到 ${subfolders.length} 个子文件夹:`);
    subfolders.forEach(f => console.log(`  - ${path.basename(f)}`));
    
    // 输出文件夹
    const outputDir = path.join(parentFolder, '_processed_output');
    ensureDir(outputDir);
    console.log(`\n输出将保存到: ${outputDir}`);
    
    // 一次性确认所有选项
    console.log('\n' + '-'.repeat(50));
    console.log('请确认以下选项 (用空格分隔，直接回车使用默认值):');
    console.log('  1. 显示浏览器窗口? (Y/n) [默认: Y]');
    if (subfolders.length > 1) {
        console.log('  2. 同时处理几个文件夹? (1-10) [默认: 3]');
        console.log('\n示例: y 3  或  n 5  或直接回车');
    } else {
        console.log('\n示例: y  或  n  或直接回车');
    }
    console.log('-'.repeat(50));
    
    const answers = (await prompt('请输入: ')).trim().split(/\s+/);
    
    // 解析答案
    const showBrowser = (answers[0] || 'y').toLowerCase() !== 'n';
    let parallelCount = 3;  // 默认值改为3
    if (subfolders.length > 1) {
        parallelCount = Math.min(10, Math.max(1, parseInt(answers[1]) || 3));  // 上限改为10，默认3
    } else {
        parallelCount = 1;
    }
    
    // 显示确认的设置
    console.log('\n设置确认:');
    console.log(`  - 显示浏览器: ${showBrowser ? '是' : '否'}`);
    console.log(`  - 并行数量: ${parallelCount}`);
    console.log(`  - 待处理: ${subfolders.length} 个文件夹`);
    
    await prompt('\n按回车键开始处理...');
    
    console.log(`\n正在启动 ${parallelCount} 个浏览器实例...`);
    
    // 创建多个浏览器实例
    const browsers = [];
    const contexts = [];
    for (let i = 0; i < parallelCount; i++) {
        const browser = await chromium.launch({
            headless: !showBrowser,
            slowMo: 50
        });
        const context = await browser.newContext({
            acceptDownloads: true,
            locale: 'zh-CN'
        });
        browsers.push(browser);
        contexts.push(context);
    }
    
    // 统计成功和失败
    const results = {
        success: [],
        failed: []
    };
    
    try {
        // 并行处理文件夹
        let completed = 0;
        const total = subfolders.length;
        
        // 分批并行处理
        for (let i = 0; i < subfolders.length; i += parallelCount) {
            const batch = subfolders.slice(i, i + parallelCount);
            const tasks = batch.map((folder, idx) => {
                const context = contexts[idx];
                const folderName = path.basename(folder);
                return processFolder(context, folder, outputDir)
                    .then(() => {
                        completed++;
                        results.success.push(folderName);
                        console.log(`\n[总进度: ${completed}/${total}]`);
                    })
                    .catch(e => {
                        completed++;
                        results.failed.push({ name: folderName, error: e.message });
                        console.log(`[错误] 处理 ${folderName} 失败: ${e.message}`);
                    });
            });
            
            // 等待当前批次完成
            await Promise.all(tasks);
        }
    } catch (e) {
        console.log(`[错误] ${e.message}`);
    } finally {
        // 关闭所有浏览器
        for (const browser of browsers) {
            await browser.close();
        }
    }
    
    // 输出最终统计日志
    console.log('\n' + '='.repeat(50));
    console.log('处理完成! 统计结果:');
    console.log('='.repeat(50));
    
    console.log(`\n✅ 成功: ${results.success.length} 个`);
    if (results.success.length > 0) {
        results.success.forEach(name => console.log(`   - ${name}`));
    }
    
    console.log(`\n❌ 失败: ${results.failed.length} 个`);
    if (results.failed.length > 0) {
        results.failed.forEach(item => console.log(`   - ${item.name}: ${item.error}`));
    }
    
    console.log('\n' + '-'.repeat(50));
    console.log(`输出目录: ${outputDir}`);
    console.log('='.repeat(50));
    
    await prompt('\n按回车键退出...');
}

main().catch(console.error);

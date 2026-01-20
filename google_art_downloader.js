/**
 * 从指定 Google 表格中查找“项目状态 = 运行中”的行，
 * 打开对应的 Google Drive「美术链接」文件夹，
 * 下载其中的压缩包（zip），解压到本地，
 * 然后调用现有的 image_processor.js 对解压后的图片做转换+压缩。
 *
 * 使用说明（首次）：
 * 1. 运行：node google_art_downloader.js
 * 2. 浏览器会弹出并打开表格地址，如果还没登录 Google，请在这个窗口里登录一次。
 * 3. 登录完成后，不要关浏览器，脚本会自动在表格里查找“运行中”的行并处理。
 *
 * 登录状态 / Cookie 会保存在本项目目录下的 _google_profile 里，
 * 以后再次运行脚本会自动复用，无需重复登录。
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 你的表格地址
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1UPs8r7YsazA5Zeaox7I9YDaQY4U0nj4NSSL-K6nPrWs/edit?pli=1&gid=0#gid=0';

// 表格里列的索引（从 0 开始计数）——根据你截图的列顺序来写：
// 备注 | 项目名称 | 色调 | 项目状态 | API状态 | 代码迭代 | 所属 | 区域 | 美术进度 | 项目域名 | 美术链接 | 备注2(如果有)
const STATUS_COL_INDEX = 3; // “项目状态”列
const ART_LINK_COL_INDEX = 10; // “美术链接”列

// 需要匹配的“运行中”状态文本
const RUNNING_STATUS_TEXT = '运行中';

// 下载 / 解压 / 处理的根目录
const ROOT_OUTPUT_DIR = path.join(__dirname, 'google_art_output');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 调用你现有的 image_processor.js 对某个文件夹里的图片做转换+压缩
 * 等价于：node image_processor.js "某个文件夹"
 */
function runImageProcessor(folderPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n[处理] 调用 image_processor.js 处理文件夹: ${folderPath}`);

    const child = execFile(
      process.execPath, // 当前 Node 可执行文件
      [path.join(__dirname, 'image_processor.js'), folderPath],
      {
        cwd: __dirname,
        windowsHide: false,
      },
      (error) => {
        if (error) {
          console.log(`[处理] image_processor.js 执行失败: ${error.message}`);
          reject(error);
        } else {
          console.log('[处理] image_processor.js 执行完成');
          resolve();
        }
      }
    );

    child.stdout?.on('data', (data) => process.stdout.write(data));
    child.stderr?.on('data', (data) => process.stderr.write(data));
  });
}

/**
 * 解压 zip 文件到指定目录
 * 使用 PowerShell Expand-Archive，和 image_processor.js 里的逻辑保持一致风格
 */
function unzipFile(zipPath, destDir) {
  const { execSync } = require('child_process');
  console.log(`  [解压] 正在解压: ${path.basename(zipPath)}`);
  ensureDir(destDir);

  try {
    const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
    execSync(cmd, { stdio: 'ignore' });
    console.log(`  [解压] 解压完成: ${destDir}`);
    return true;
  } catch (e) {
    console.log(`  [解压] 失败: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Google 表格 → Drive 美术包下载 → 本地批处理');
  console.log('='.repeat(60));

  ensureDir(ROOT_OUTPUT_DIR);

  // 使用持久化配置目录，保存 Google 登录状态
  const userDataDir = path.join(__dirname, '_google_profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    locale: 'zh-CN',
    slowMo: 50,
  });

  const page = await context.newPage();

  try {
    console.log('\n[表格] 打开表格页面...');
    await page.goto(SHEET_URL, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(5000);

    console.log('[表格] 如果还没登录 Google，请在弹出的窗口里登录账号。');
    console.log('[表格] 登录完成后，确保能看到表格内容，无权限错误。');

    // 再等一会儿，给你时间登录 / 加载表格
    await page.waitForTimeout(8000);

    // 查找所有可见行（Google 表格会虚拟化，只会有一部分行在 DOM 中）
    const rowLocators = await page.locator('[role="row"]').all();
    console.log(`[表格] 当前视图中检测到 ${rowLocators.length} 行（包含表头行）。`);

    const tasks = [];

    for (const row of rowLocators) {
      // 跳过表头：表头一般是 columnheader，而不是 gridcell
      const isHeader = await row
        .locator('[role="columnheader"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (isHeader) continue;

      const cells = row.locator('[role="gridcell"]');
      const cellCount = await cells.count();
      if (cellCount <= Math.max(STATUS_COL_INDEX, ART_LINK_COL_INDEX)) {
        continue;
      }

      const statusText = (await cells.nth(STATUS_COL_INDEX).innerText()).trim();
      if (!statusText.includes(RUNNING_STATUS_TEXT)) {
        continue;
      }

      const projectName = (await cells.nth(1).innerText().catch(() => '未知项目')).trim();

      // 在“美术链接”所在的单元格中寻找 Google Drive 文件夹链接
      const artCell = cells.nth(ART_LINK_COL_INDEX);
      const linkLocator = artCell.locator(
        'a[href^="https://drive.google.com/drive/folders/"], a[href^="https://drive.google.com/drive/u/"]'
      );

      const hasLink = await linkLocator.first().isVisible().catch(() => false);
      if (!hasLink) {
        console.log(`[表格] 项目 "${projectName}" 标记为运行中，但未找到美术链接，跳过。`);
        continue;
      }

      const artLinkHref = await linkLocator.first().getAttribute('href');
      if (!artLinkHref) {
        console.log(`[表格] 项目 "${projectName}" 的美术链接为空，跳过。`);
        continue;
      }

      console.log(`\n[表格] 找到运行中项目: ${projectName}`);
      console.log(`        美术链接: ${artLinkHref}`);

      tasks.push({ projectName, artLinkHref });
    }

    if (tasks.length === 0) {
      console.log('\n[表格] 当前视图中没有找到“项目状态 = 运行中”的行。');
      console.log('        如有需要，请在表格中向下滚动后再重新运行脚本。');
      return;
    }

    console.log(`\n[表格] 共找到 ${tasks.length} 个“运行中”的项目，将依次处理。`);

    // 逐个项目处理：打开美术链接 → 下载 zip → 解压 → 调用 image_processor.js
    for (const task of tasks) {
      const { projectName, artLinkHref } = task;
      const safeProjectName = projectName.replace(/[\\/:*?"<>|]/g, '_') || 'unnamed';
      const projectRoot = path.join(ROOT_OUTPUT_DIR, safeProjectName);
      const downloadDir = path.join(projectRoot, 'downloads');
      const unzipDir = path.join(projectRoot, 'unzipped');

      ensureDir(downloadDir);
      ensureDir(unzipDir);

      console.log('\n' + '-'.repeat(60));
      console.log(`[项目] 处理项目: ${projectName}`);
      console.log('-'.repeat(60));

      const drivePage = await context.newPage();
      try {
        console.log('[Drive] 打开美术链接页面...');
        await drivePage.goto(artLinkHref, {
          waitUntil: 'networkidle',
          timeout: 120000,
        });
        await drivePage.waitForTimeout(6000);

        console.log('[Drive] 请确认页面中能看到压缩包（zip）文件列表。');

        // 这里采用“点击所有含 .zip 的条目右键菜单里的下载”的思路比较复杂，
        // 简化为：你可以在 Drive 里手动选中需要下载的 zip 文件，然后脚本监听下载事件并保存。
        // 为了自动化程度更高，下面尝试点击“更多操作”里的“下载”按钮下载当前选中项。

        // 选中页面中所有名称包含 .zip 的文件行并逐个下载
        const fileRows = drivePage.locator('[role="row"]');
        const rowCount = await fileRows.count();
        console.log(`[Drive] 检测到 ${rowCount} 行（包含表头），尝试查找 zip 文件。`);

        for (let i = 0; i < rowCount; i++) {
          const row = fileRows.nth(i);
          const nameCell = row.locator('[role="gridcell"]').first();
          const nameText = (await nameCell.innerText().catch(() => '')).trim();
          if (!nameText.toLowerCase().endsWith('.zip')) continue;

          console.log(`[Drive] 找到压缩包文件: ${nameText}`);

          // 单击选中该行
          await row.click({ button: 'left' });
          await drivePage.waitForTimeout(500);

          // 通过键盘快捷键 Shift+Z 之类不是下载，这里尝试使用 "更多操作" 菜单里的“下载”按钮：
          // 打开右上角的「更多操作」菜单（如果存在）
          // 如果选择器不生效，可以改为你手动点击下载，脚本只负责保存。

          let download;
          try {
            [download] = await Promise.all([
              drivePage.waitForEvent('download', { timeout: 120000 }),
              // 触发“下载”动作：这里用快捷键 d 可能不可靠，优先建议你手动点下载
              // 如果你更愿意手动点击，这里可以改成：
              // Promise.resolve(drivePage.waitForTimeout(1))
              drivePage.keyboard.press('Shift+F10').then(async () => {
                // 打开右键菜单后，尝试按键盘上的 "d" (英文界面为 Download)
                // 如果是中文界面，键位可能不同，你可以改为手动点击。
                await drivePage.waitForTimeout(1000);
                await drivePage.keyboard.type('d');
              }),
            ]);
          } catch (e) {
            console.log(`[Drive] 自动触发下载失败，可以在页面中手动点击 "${nameText}" 的下载按钮。`);
            try {
              [download] = await Promise.all([
                drivePage.waitForEvent('download', { timeout: 180000 }),
              ]);
            } catch {
              console.log(`[Drive] 等待 "${nameText}" 下载超时，跳过该文件。`);
              continue;
            }
          }

          const suggestedName = download.suggestedFilename();
          const savePath = path.join(downloadDir, suggestedName);
          await download.saveAs(savePath);
          console.log(`[Drive] 已下载: ${suggestedName}`);

          // 解压该 zip
          if (savePath.toLowerCase().endsWith('.zip')) {
            unzipFile(savePath, unzipDir);
          }
        }

        // 如果有解压出来的内容，再调用 image_processor.js 做后续处理
        const hasUnzipped =
          fs.existsSync(unzipDir) &&
          fs.readdirSync(unzipDir).some((name) => !name.startsWith('.'));

        if (hasUnzipped) {
          await runImageProcessor(unzipDir);
        } else {
          console.log('[项目] 未检测到解压后的文件，跳过 image_processor 处理。');
        }
      } catch (e) {
        console.log(`[Drive] 处理项目 "${projectName}" 时出错: ${e.message}`);
      } finally {
        await drivePage.close();
      }
    }
  } catch (e) {
    console.log(`[错误] 主流程出错: ${e.message}`);
  } finally {
    await context.close();
  }

  console.log('\n所有项目处理完成。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


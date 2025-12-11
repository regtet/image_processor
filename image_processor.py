"""
图片批量处理自动化脚本
使用 Playwright 自动化 imagestool.com 进行格式转换和压缩
"""

import os
import time
import glob
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


class ImageProcessor:
    def __init__(self, input_folder: str, output_folder: str = None):
        """
        初始化图片处理器
        
        Args:
            input_folder: 输入图片文件夹路径
            output_folder: 输出文件夹路径，默认在输入文件夹下创建 'processed' 子文件夹
        """
        self.input_folder = Path(input_folder)
        self.output_folder = Path(output_folder) if output_folder else self.input_folder / "processed"
        self.converted_folder = self.output_folder / "converted"
        self.compressed_folder = self.output_folder / "compressed"
        
        # 创建输出目录
        self.converted_folder.mkdir(parents=True, exist_ok=True)
        self.compressed_folder.mkdir(parents=True, exist_ok=True)
        
        # 支持的图片格式
        self.supported_formats = ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif', '*.bmp', '*.tiff']
        
    def get_images(self) -> list:
        """获取文件夹中所有图片文件"""
        images = []
        for fmt in self.supported_formats:
            images.extend(self.input_folder.glob(fmt))
            images.extend(self.input_folder.glob(fmt.upper()))
        return sorted(images)
    
    def run(self, 
            target_format: str = "webp",
            convert_url: str = "https://to.imagestool.com/",
            compress_url: str = "https://imagestool.com/compress-image",
            headless: bool = False,
            batch_size: int = 10):
        """
        运行自动化处理流程
        
        Args:
            target_format: 目标转换格式 (webp, png, jpg, etc.)
            convert_url: 格式转换页面URL
            compress_url: 图片压缩页面URL
            headless: 是否无头模式运行（不显示浏览器窗口）
            batch_size: 每批处理的图片数量
        """
        images = self.get_images()
        if not images:
            print(f"❌ 在 {self.input_folder} 中没有找到图片文件")
            return
        
        print(f"📁 找到 {len(images)} 张图片待处理")
        print(f"🎯 目标格式: {target_format}")
        print(f"📂 转换后保存到: {self.converted_folder}")
        print(f"📂 压缩后保存到: {self.compressed_folder}")
        print("-" * 50)
        
        with sync_playwright() as p:
            # 启动浏览器
            browser = p.chromium.launch(
                headless=headless,
                downloads_path=str(self.output_folder)
            )
            context = browser.new_context(
                accept_downloads=True,
                locale='zh-CN'
            )
            
            # 分批处理图片
            for i in range(0, len(images), batch_size):
                batch = images[i:i + batch_size]
                print(f"\n🔄 处理第 {i//batch_size + 1} 批 ({len(batch)} 张图片)...")
                
                # 步骤1: 格式转换
                converted_files = self._convert_format(
                    context, batch, target_format, convert_url
                )
                
                if converted_files:
                    # 步骤2: 压缩图片
                    self._compress_images(context, converted_files, compress_url)
            
            browser.close()
        
        print("\n" + "=" * 50)
        print("✅ 所有图片处理完成！")
        print(f"📂 转换后的图片: {self.converted_folder}")
        print(f"📂 压缩后的图片: {self.compressed_folder}")
    
    def _convert_format(self, context, images: list, target_format: str, url: str) -> list:
        """格式转换"""
        print(f"  📤 上传图片进行格式转换...")
        page = context.new_page()
        converted_files = []
        
        try:
            # 构建转换URL（imagestool格式: to.imagestool.com/to-webp）
            convert_url = f"https://to.imagestool.com/to-{target_format.lower()}"
            page.goto(convert_url, timeout=60000)
            page.wait_for_load_state('networkidle', timeout=30000)
            
            # 等待上传区域出现
            time.sleep(2)
            
            # 查找文件上传input
            file_input = page.locator('input[type="file"]').first
            
            # 上传所有图片
            file_paths = [str(img) for img in images]
            file_input.set_input_files(file_paths)
            
            print(f"  ⏳ 等待转换完成...")
            
            # 等待转换完成（查找下载按钮或完成状态）
            time.sleep(3)  # 给页面一些处理时间
            
            # 等待所有文件转换完成
            page.wait_for_selector('.download-btn, [class*="download"], button:has-text("下载")', 
                                   timeout=120000)
            
            # 额外等待确保所有文件处理完毕
            time.sleep(2)
            
            # 点击全部下载按钮
            download_all_btn = page.locator('button:has-text("全部下载"), .download-all, [class*="downloadAll"]').first
            
            if download_all_btn.is_visible():
                with page.expect_download(timeout=60000) as download_info:
                    download_all_btn.click()
                download = download_info.value
                
                # 保存下载的文件
                save_path = self.converted_folder / download.suggested_filename
                download.save_as(save_path)
                print(f"  ✅ 已下载: {save_path.name}")
                
                # 如果是zip文件，解压
                if save_path.suffix.lower() == '.zip':
                    import zipfile
                    with zipfile.ZipFile(save_path, 'r') as zip_ref:
                        zip_ref.extractall(self.converted_folder)
                    os.remove(save_path)
                    converted_files = list(self.converted_folder.glob(f'*.{target_format}'))
                else:
                    converted_files = [save_path]
            else:
                # 逐个下载
                download_btns = page.locator('.download-btn, [class*="download"]:not([class*="all"])').all()
                for idx, btn in enumerate(download_btns):
                    try:
                        with page.expect_download(timeout=30000) as download_info:
                            btn.click()
                        download = download_info.value
                        save_path = self.converted_folder / download.suggested_filename
                        download.save_as(save_path)
                        converted_files.append(save_path)
                        print(f"  ✅ 已下载: {save_path.name}")
                    except Exception as e:
                        print(f"  ⚠️ 下载第 {idx+1} 个文件失败: {e}")
            
            print(f"  ✅ 格式转换完成，共 {len(converted_files)} 个文件")
            
        except PlaywrightTimeoutError as e:
            print(f"  ❌ 超时错误: {e}")
        except Exception as e:
            print(f"  ❌ 转换过程出错: {e}")
        finally:
            page.close()
        
        return converted_files
    
    def _compress_images(self, context, images: list, url: str):
        """压缩图片"""
        if not images:
            return
        
        print(f"  📤 上传图片进行压缩...")
        page = context.new_page()
        
        try:
            page.goto(url, timeout=60000)
            page.wait_for_load_state('networkidle', timeout=30000)
            
            time.sleep(2)
            
            # 查找文件上传input
            file_input = page.locator('input[type="file"]').first
            
            # 上传图片
            file_paths = [str(img) for img in images if img.exists()]
            if not file_paths:
                print("  ⚠️ 没有找到需要压缩的文件")
                return
                
            file_input.set_input_files(file_paths)
            
            print(f"  ⏳ 等待压缩完成...")
            time.sleep(3)
            
            # 等待压缩完成
            page.wait_for_selector('.download-btn, [class*="download"], button:has-text("下载")', 
                                   timeout=120000)
            time.sleep(2)
            
            # 下载压缩后的文件
            download_all_btn = page.locator('button:has-text("全部下载"), .download-all, [class*="downloadAll"]').first
            
            if download_all_btn.is_visible():
                with page.expect_download(timeout=60000) as download_info:
                    download_all_btn.click()
                download = download_info.value
                
                save_path = self.compressed_folder / download.suggested_filename
                download.save_as(save_path)
                print(f"  ✅ 已下载: {save_path.name}")
                
                # 解压zip
                if save_path.suffix.lower() == '.zip':
                    import zipfile
                    with zipfile.ZipFile(save_path, 'r') as zip_ref:
                        zip_ref.extractall(self.compressed_folder)
                    os.remove(save_path)
            else:
                download_btns = page.locator('.download-btn, [class*="download"]:not([class*="all"])').all()
                for idx, btn in enumerate(download_btns):
                    try:
                        with page.expect_download(timeout=30000) as download_info:
                            btn.click()
                        download = download_info.value
                        save_path = self.compressed_folder / download.suggested_filename
                        download.save_as(save_path)
                        print(f"  ✅ 已下载: {save_path.name}")
                    except Exception as e:
                        print(f"  ⚠️ 下载第 {idx+1} 个文件失败: {e}")
            
            print(f"  ✅ 压缩完成")
            
        except PlaywrightTimeoutError as e:
            print(f"  ❌ 超时错误: {e}")
        except Exception as e:
            print(f"  ❌ 压缩过程出错: {e}")
        finally:
            page.close()


def select_folder():
    """弹出文件夹选择对话框"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()  # 隐藏主窗口
        root.attributes('-topmost', True)  # 置顶
        
        folder = filedialog.askdirectory(title="选择包含图片的文件夹")
        root.destroy()
        
        return folder if folder else None
    except Exception as e:
        print(f"无法打开文件夹选择对话框: {e}")
        return input("请手动输入文件夹路径: ").strip()


def main():
    print("=" * 50)
    print("🖼️  图片批量处理工具")
    print("   格式转换 + 压缩一站式处理")
    print("=" * 50)
    
    # 选择输入文件夹
    print("\n📁 请选择包含图片的文件夹...")
    input_folder = select_folder()
    
    if not input_folder:
        print("❌ 未选择文件夹，程序退出")
        return
    
    print(f"✅ 已选择: {input_folder}")
    
    # 选择目标格式
    print("\n🎯 请选择目标格式:")
    print("   1. WebP (推荐，体积小)")
    print("   2. PNG")
    print("   3. JPG")
    print("   4. AVIF")
    
    format_choice = input("请输入数字 (默认1): ").strip() or "1"
    format_map = {"1": "webp", "2": "png", "3": "jpg", "4": "avif"}
    target_format = format_map.get(format_choice, "webp")
    
    # 是否显示浏览器
    show_browser = input("\n👁️ 是否显示浏览器窗口? (y/N): ").strip().lower() == 'y'
    
    # 创建处理器并运行
    processor = ImageProcessor(input_folder)
    processor.run(
        target_format=target_format,
        headless=not show_browser
    )
    
    # 询问是否继续处理其他文件夹
    while True:
        again = input("\n🔄 是否处理其他文件夹? (y/N): ").strip().lower()
        if again == 'y':
            input_folder = select_folder()
            if input_folder:
                processor = ImageProcessor(input_folder)
                processor.run(target_format=target_format, headless=not show_browser)
        else:
            break
    
    print("\n👋 感谢使用，再见！")


if __name__ == "__main__":
    main()


Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public static class GuqinEnhance
{
    static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        GraphicsPath path = new GraphicsPath();
        float d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static Bitmap CreateSeal(string ch, int size, Color bg, Color fg, string fontName, float emRatio, float strokeRatio, float cornerRatio)
    {
        Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            float radius = size * cornerRatio;
            using (GraphicsPath rr = RoundedRect(new RectangleF(0, 0, size, size), radius))
            using (SolidBrush bgBrush = new SolidBrush(bg))
            {
                g.FillPath(bgBrush, rr);
            }
            using (FontFamily ff = new FontFamily(fontName))
            using (GraphicsPath textPath = new GraphicsPath())
            {
                float emSize = size * emRatio;
                StringFormat sf = new StringFormat();
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                RectangleF box = new RectangleF(0, 0, size, size);
                textPath.AddString(ch, ff, (int)FontStyle.Bold, emSize, box, sf);
                using (Pen pen = new Pen(fg, Math.Max(2f, size * strokeRatio)))
                {
                    pen.LineJoin = LineJoin.Round;
                    g.DrawPath(pen, textPath);
                }
            }
        }
        return bmp;
    }

    public static Bitmap CropRegion(Bitmap src, int x0, int y0, int w, int h)
    {
        Bitmap cropped = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(cropped))
        {
            g.DrawImage(src, new Rectangle(0,0,w,h), new Rectangle(x0,y0,w,h), GraphicsUnit.Pixel);
        }
        return cropped;
    }

    public static Bitmap ResizeHQ(Bitmap src, int w, int h)
    {
        Bitmap result = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(result))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, w, h);
        }
        return result;
    }

    // darkens existing ink pixels, then grows (dilates) them by a few pixels
    // so thin line art reads as bolder and higher-contrast, like an ink stamp
    public static Bitmap DarkenAndThicken(Bitmap src, int threshold, double darkenFactor, int dilateIters, Color inkColor)
    {
        int w = src.Width, h = src.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData sd = src.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = sd.Stride;
        byte[] buf = new byte[stride * h];
        Marshal.Copy(sd.Scan0, buf, 0, buf.Length);
        src.UnlockBits(sd);

        byte[] outBuf = new byte[buf.Length];
        Array.Copy(buf, outBuf, buf.Length);

        bool[] mask = new bool[w * h];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = y * stride + x * 4;
                byte b = buf[idx]; byte g = buf[idx+1]; byte r = buf[idx+2];
                int brightness = (r + g + b) / 3;
                bool ink = brightness < threshold;
                mask[y * w + x] = ink;
                if (ink)
                {
                    outBuf[idx]   = (byte)Math.Max(0, b * darkenFactor);
                    outBuf[idx+1] = (byte)Math.Max(0, g * darkenFactor);
                    outBuf[idx+2] = (byte)Math.Max(0, r * darkenFactor);
                }
            }
        }

        bool[] cur = mask;
        for (int iter = 0; iter < dilateIters; iter++)
        {
            bool[] next = (bool[])cur.Clone();
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    int p = y * w + x;
                    if (cur[p]) continue;
                    bool neighborInk =
                        (x > 0 && cur[p-1]) || (x < w-1 && cur[p+1]) ||
                        (y > 0 && cur[p-w]) || (y < h-1 && cur[p+w]);
                    if (neighborInk)
                    {
                        next[p] = true;
                        int idx = y * stride + x * 4;
                        outBuf[idx] = inkColor.B; outBuf[idx+1] = inkColor.G; outBuf[idx+2] = inkColor.R;
                        if (outBuf[idx+3] < 180) outBuf[idx+3] = 255;
                    }
                }
            }
            cur = next;
        }

        Bitmap outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        BitmapData od = outBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(outBuf, 0, od.Scan0, outBuf.Length);
        outBmp.UnlockBits(od);
        return outBmp;
    }

    // snaps any near-background pixel exactly to bg (kills faint seams before thickening)
    public static Bitmap SnapBackground(Bitmap src, Color bg, int hiThreshold)
    {
        int w = src.Width, h = src.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData sd = src.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = sd.Stride;
        byte[] buf = new byte[stride * h];
        Marshal.Copy(sd.Scan0, buf, 0, buf.Length);
        src.UnlockBits(sd);
        byte[] outBuf = new byte[buf.Length];
        Array.Copy(buf, outBuf, buf.Length);
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = y * stride + x * 4;
                byte b = buf[idx]; byte g = buf[idx+1]; byte r = buf[idx+2];
                int brightness = (r + g + b) / 3;
                if (brightness >= hiThreshold)
                {
                    outBuf[idx] = bg.B; outBuf[idx+1] = bg.G; outBuf[idx+2] = bg.R;
                }
            }
        }
        Bitmap outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        BitmapData od = outBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(outBuf, 0, od.Scan0, outBuf.Length);
        outBmp.UnlockBits(od);
        return outBmp;
    }

    public static void FillRect(Bitmap bmp, Rectangle r, Color c)
    {
        using (Graphics g = Graphics.FromImage(bmp))
        using (SolidBrush br = new SolidBrush(c))
        {
            g.FillRectangle(br, r);
        }
    }

    public static void DrawTrackedText(Graphics g, string text, Font font, Brush brush, float centerX, float y, float spacing)
    {
        List<float> widths = new List<float>();
        float totalWidth = 0;
        foreach (char c in text)
        {
            SizeF sz = g.MeasureString(c.ToString(), font, int.MaxValue, StringFormat.GenericTypographic);
            widths.Add(sz.Width);
            totalWidth += sz.Width + spacing;
        }
        totalWidth -= spacing;
        float x = centerX - totalWidth / 2f;
        int i = 0;
        foreach (char c in text)
        {
            g.DrawString(c.ToString(), font, brush, x, y, StringFormat.GenericTypographic);
            x += widths[i] + spacing;
            i++;
        }
    }
}
"@

function Rebuild-GuqinCard {
    param(
        [string]$srcPath,
        [string]$outPath,
        [string]$char,
        [string]$caption,
        [System.Drawing.Color]$bgFlat,
        [System.Drawing.Color]$sealRed,
        [System.Drawing.Color]$white,
        [System.Drawing.Color]$captionColor,
        [System.Drawing.Color]$inkColor
    )

    $bmp = New-Object System.Drawing.Bitmap($srcPath)
    $w = $bmp.Width; $h = $bmp.Height

    # crop out the content block placed by the previous pass (known layout: scale 0.6, top margin 11%)
    $oldSize = [int]([Math]::Round($w * 0.6))
    $oldX = [int](($w - $oldSize) / 2)
    $oldY = [int]($h * 0.11)
    $contentCrop = [GuqinEnhance]::CropRegion($bmp, $oldX, $oldY, $oldSize, $oldSize)

    # the old seal (top-right, absolute canvas coords) can clip into this crop's
    # corner -- blank that corner out in the crop's local coordinates first
    $oldSealSize = [int]([Math]::Round($w * 0.095))
    $oldSealX = [int]([Math]::Round($w * 0.767))
    $oldSealY = [int]([Math]::Round($h * 0.10))
    $localSealX = [Math]::Max(0, $oldSealX - $oldX - 4)
    $localSealY = [Math]::Max(0, $oldSealY - $oldY - 4)
    $localSealW = $oldSize - $localSealX
    $localSealH = ($oldSealY - $oldY) + $oldSealSize + 8
    if ($localSealW -gt 0 -and $localSealH -gt 0) {
        [GuqinEnhance]::FillRect($contentCrop, (New-Object System.Drawing.Rectangle($localSealX, 0, $localSealW, $localSealH)), $bgFlat)
    }

    # kill any faint seam left over from the previous pass before thickening
    $cleaned = [GuqinEnhance]::SnapBackground($contentCrop, $bgFlat, 205)

    # enlarge slightly (0.6 -> 0.72 of canvas) and make the line art bolder/darker
    $newSize = [int]([Math]::Round($w * 0.72))
    $enlarged = [GuqinEnhance]::ResizeHQ($cleaned, $newSize, $newSize)
    $bold = [GuqinEnhance]::DarkenAndThicken($enlarged, 165, 0.62, 1, $inkColor)

    $canvas = New-Object System.Drawing.Bitmap($w, $h)
    $gc = [System.Drawing.Graphics]::FromImage($canvas)
    $gc.Clear($bgFlat)

    $pasteX = [int](($w - $newSize) / 2)
    $pasteY = [int]($h * 0.09)
    $gc.DrawImage($bold, $pasteX, $pasteY, $newSize, $newSize)

    $targetSize = [int]([Math]::Round($w * 0.095))
    $targetX = [int]([Math]::Round($w * 0.767))
    $targetY = [int]([Math]::Round($h * 0.10))
    $seal = [GuqinEnhance]::CreateSeal($char, 400, $sealRed, $white, "Microsoft YaHei", 0.5, 0.028, 0.16)
    $sealFinal = [GuqinEnhance]::ResizeHQ($seal, $targetSize, $targetSize)
    $gc.DrawImage($sealFinal, $targetX, $targetY, $targetSize, $targetSize)

    $gc.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gc.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font("Arial", ($w * 0.0265), [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush($captionColor)
    $captionY = $pasteY + $newSize + ($h * 0.045)
    [GuqinEnhance]::DrawTrackedText($gc, $caption, $font, $brush, ($w/2), $captionY, ($w * 0.012))

    $gc.Dispose()
    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved: $outPath"

    $bmp.Dispose(); $contentCrop.Dispose(); $cleaned.Dispose(); $enlarged.Dispose(); $bold.Dispose()
    $canvas.Dispose(); $seal.Dispose(); $sealFinal.Dispose(); $font.Dispose(); $brush.Dispose()
}

Add-Type -AssemblyName System.Drawing
$teaAsset = New-Object System.Drawing.Bitmap("C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\assets\茶器-泡茶主器.png")
$bgPx = $teaAsset.GetPixel(10, 10)
$teaAsset.Dispose()

$bgFlat = [System.Drawing.Color]::FromArgb($bgPx.R, $bgPx.G, $bgPx.B)
$sealRed = [System.Drawing.Color]::FromArgb(145, 34, 36)
$white = [System.Drawing.Color]::White
$captionColor = [System.Drawing.Color]::FromArgb(58, 52, 42)
$inkColor = [System.Drawing.Color]::FromArgb(58, 52, 42)

$guqinBase = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\斫琴甄选\斫琴甄选分类图标"
$previewDir = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview"

Rebuild-GuqinCard -srcPath "$guqinBase\初弦.png" -outPath "$previewDir\初弦.png" -char "初" -caption "BEGINNER" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor -inkColor $inkColor
Rebuild-GuqinCard -srcPath "$guqinBase\妙音.png" -outPath "$previewDir\妙音.png" -char "妙" -caption "PERFORMANCE" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor -inkColor $inkColor
Rebuild-GuqinCard -srcPath "$guqinBase\藏锋.png" -outPath "$previewDir\藏锋.png" -char "藏" -caption "COLLECTION" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor -inkColor $inkColor
Rebuild-GuqinCard -srcPath "$guqinBase\携行.png" -outPath "$previewDir\携行.png" -char "行" -caption "TRAVELING" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor -inkColor $inkColor

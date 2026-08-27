Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public static class GuqinLayout
{
    public static int[] GetRedBBox(Bitmap bmp, int x0, int y0, int x1, int y1)
    {
        BitmapData bd = bmp.LockBits(new Rectangle(0,0,bmp.Width,bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = bd.Stride;
        int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
        byte[] buf = new byte[stride * bmp.Height];
        Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(bd);
        for (int y = y0; y < y1; y++)
        {
            for (int x = x0; x < x1; x++)
            {
                int idx = y * stride + x * 4;
                byte b = buf[idx]; byte g = buf[idx+1]; byte r = buf[idx+2];
                if (r > 110 && (r - g) > 35 && (r - b) > 35)
                {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        return new int[] { minX, minY, maxX, maxY };
    }

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

    // fades any light "paper" pixel toward the exact flat background color,
    // leaving darker ink strokes (and their anti-aliased edges) untouched,
    // so a shrunk illustration blends into a flat canvas with no visible seam
    public static Bitmap DeTexture(Bitmap src, Color bg, int lo, int hi)
    {
        int w = src.Width, h = src.Height;
        Bitmap outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData sd = src.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData od = outBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int stride = sd.Stride;
        byte[] buf = new byte[stride * h];
        Marshal.Copy(sd.Scan0, buf, 0, buf.Length);
        src.UnlockBits(sd);
        byte[] outBuf = new byte[stride * h];

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = y * stride + x * 4;
                byte b = buf[idx]; byte g = buf[idx+1]; byte r = buf[idx+2]; byte a = buf[idx+3];
                int brightness = (r + g + b) / 3;
                double t;
                if (brightness >= hi) t = 1.0;
                else if (brightness <= lo) t = 0.0;
                else t = (double)(brightness - lo) / (hi - lo);
                byte nr = (byte)(r + (bg.R - r) * t);
                byte ng = (byte)(g + (bg.G - g) * t);
                byte nb = (byte)(b + (bg.B - b) * t);
                outBuf[idx] = nb; outBuf[idx+1] = ng; outBuf[idx+2] = nr; outBuf[idx+3] = a;
            }
        }
        Marshal.Copy(outBuf, 0, od.Scan0, outBuf.Length);
        outBmp.UnlockBits(od);
        return outBmp;
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
        [System.Drawing.Color]$captionColor
    )

    $bmp = New-Object System.Drawing.Bitmap($srcPath)
    $w = $bmp.Width; $h = $bmp.Height

    # locate + erase the current seal to recover clean content underneath
    $searchX0 = [int]($w * 0.5); $searchY0 = 0; $searchX1 = $w; $searchY1 = [int]($h * 0.35)
    $bbox = [GuqinLayout]::GetRedBBox($bmp, $searchX0, $searchY0, $searchX1, $searchY1)
    $bx0=$bbox[0]; $by0=$bbox[1]; $bx1=$bbox[2]; $by1=$bbox[3]
    $bw = $bx1 - $bx0; $bh = $by1 - $by0
    $erasePad = 16
    $ex0 = [Math]::Max(0, $bx0 - $erasePad); $ey0 = [Math]::Max(0, $by0 - $erasePad)
    $ew = $bw + 2*$erasePad; $eh = $bh + 2*$erasePad
    $patchX0 = $ex0 - $ew - 20
    if ($patchX0 -lt 0) { $patchX0 = 0 }
    $patch = [GuqinLayout]::CropRegion($bmp, $patchX0, $ey0, $ew, $eh)
    $contentOnly = New-Object System.Drawing.Bitmap($bmp)
    $gTmp = [System.Drawing.Graphics]::FromImage($contentOnly)
    $gTmp.DrawImage($patch, $ex0, $ey0, $ew, $eh)
    $gTmp.Dispose()

    # strip the paper grain from empty areas so the flat canvas shows no seam
    $deTextured = [GuqinLayout]::DeTexture($contentOnly, $bgFlat, 195, 240)

    # shrink the whole seal-free illustration uniformly
    $scale = 0.6
    $newW = [int]([Math]::Round($w * $scale))
    $newH = [int]([Math]::Round($h * $scale))
    $shrunk = [GuqinLayout]::ResizeHQ($deTextured, $newW, $newH)

    # fresh flat-color canvas (matches the teaware cards' plain background)
    $canvas = New-Object System.Drawing.Bitmap($w, $h)
    $gc = [System.Drawing.Graphics]::FromImage($canvas)
    $gc.Clear($bgFlat)

    $pasteX = [int](($w - $newW) / 2)
    $pasteY = [int]($h * 0.11)
    $gc.DrawImage($shrunk, $pasteX, $pasteY, $newW, $newH)

    # fresh crisp seal, same size/position as before, drawn back on top
    $targetSize = [int]([Math]::Round($w * 0.095))
    $targetX = [int]([Math]::Round($w * 0.767))
    $targetY = [int]([Math]::Round($h * 0.10))
    $seal = [GuqinLayout]::CreateSeal($char, 400, $sealRed, $white, "Microsoft YaHei", 0.5, 0.028, 0.16)
    $sealFinal = [GuqinLayout]::ResizeHQ($seal, $targetSize, $targetSize)
    $gc.DrawImage($sealFinal, $targetX, $targetY, $targetSize, $targetSize)

    # english caption, letter-spaced, centered under the shrunk illustration
    $gc.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gc.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font("Arial", ($w * 0.024), [System.Drawing.FontStyle]::Regular)
    $brush = New-Object System.Drawing.SolidBrush($captionColor)
    $captionY = $pasteY + $newH + ($h * 0.06)
    [GuqinLayout]::DrawTrackedText($gc, $caption, $font, $brush, ($w/2), $captionY, ($w * 0.012))

    $gc.Dispose()
    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved: $outPath"

    $bmp.Dispose(); $patch.Dispose(); $contentOnly.Dispose(); $deTextured.Dispose(); $shrunk.Dispose()
    $canvas.Dispose(); $seal.Dispose(); $sealFinal.Dispose(); $font.Dispose(); $brush.Dispose()
}

Add-Type -AssemblyName System.Drawing
$teaAsset = New-Object System.Drawing.Bitmap("C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\assets\茶器-泡茶主器.png")
$bgPx = $teaAsset.GetPixel(10, 10)
$teaAsset.Dispose()

$bgFlat = [System.Drawing.Color]::FromArgb($bgPx.R, $bgPx.G, $bgPx.B)
$sealRed = [System.Drawing.Color]::FromArgb(145, 34, 36)
$white = [System.Drawing.Color]::White
$captionColor = [System.Drawing.Color]::FromArgb(85, 80, 63)

Write-Output "bgFlat: $($bgPx.R),$($bgPx.G),$($bgPx.B)"

$guqinBase = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\斫琴甄选\斫琴甄选分类图标"
$previewDir = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview"

Rebuild-GuqinCard -srcPath "$guqinBase\初弦.png" -outPath "$previewDir\初弦.png" -char "初" -caption "BEGINNER" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor
Rebuild-GuqinCard -srcPath "$guqinBase\妙音.png" -outPath "$previewDir\妙音.png" -char "妙" -caption "PERFORMANCE" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor
Rebuild-GuqinCard -srcPath "$guqinBase\藏锋.png" -outPath "$previewDir\藏锋.png" -char "藏" -caption "COLLECTION" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor
Rebuild-GuqinCard -srcPath "$guqinBase\携行.png" -outPath "$previewDir\携行.png" -char "行" -caption "TRAVELING" -bgFlat $bgFlat -sealRed $sealRed -white $white -captionColor $captionColor

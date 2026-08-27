Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class IconTool
{
    public static int[] GetBBox(Bitmap bmp, int x0, int y0, int x1, int y1, int brightnessThreshold)
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
                int brightness = (r + g + b) / 3;
                if (brightness < brightnessThreshold)
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

    public static int[] GetPixel(Bitmap bmp, int x, int y)
    {
        Color c = bmp.GetPixel(x, y);
        return new int[] { c.R, c.G, c.B };
    }

    public static Bitmap CropAndScale(Bitmap src, int x0, int y0, int x1, int y1, int pad, double scale)
    {
        int cx0 = Math.Max(0, x0 - pad);
        int cy0 = Math.Max(0, y0 - pad);
        int cx1 = Math.Min(src.Width, x1 + pad);
        int cy1 = Math.Min(src.Height, y1 + pad);
        int w = cx1 - cx0, h = cy1 - cy0;
        Bitmap cropped = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(cropped))
        {
            g.DrawImage(src, new Rectangle(0,0,w,h), new Rectangle(cx0,cy0,w,h), GraphicsUnit.Pixel);
        }
        int nw = (int)(w * scale), nh = (int)(h * scale);
        Bitmap scaled = new Bitmap(nw, nh, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(scaled))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(cropped, 0, 0, nw, nh);
        }
        cropped.Dispose();
        return scaled;
    }

    public static void FillBg(Bitmap bmp, Color c)
    {
        using (Graphics g = Graphics.FromImage(bmp))
        {
            using (SolidBrush br = new SolidBrush(c)) { g.FillRectangle(br, 0, 0, bmp.Width, bmp.Height); }
        }
    }

    public static void DrawAt(Bitmap canvas, Bitmap piece, int left, int top)
    {
        using (Graphics g = Graphics.FromImage(canvas))
        {
            g.DrawImage(piece, left, top, piece.Width, piece.Height);
        }
    }
}
"@

function Process-Icon {
    param(
        [string]$srcPath,
        [string]$outPath,
        [double]$sealScale,
        [double]$iconScale,
        [double]$captionScale,
        [int]$sealMarginTop,
        [int]$sealMarginRight
    )

    $bmp = New-Object System.Drawing.Bitmap($srcPath)
    $w = $bmp.Width; $h = $bmp.Height
    $bgPx = [IconTool]::GetPixel($bmp, 20, 20)
    $bgColor = [System.Drawing.Color]::FromArgb($bgPx[0], $bgPx[1], $bgPx[2])

    $sealBBox    = [IconTool]::GetBBox($bmp, 1000, 0, 1500, 400, 220)
    $iconBBox    = [IconTool]::GetBBox($bmp, 100, 400, 1400, 1080, 220)
    $captionBBox = [IconTool]::GetBBox($bmp, 100, 1080, 1400, 1350, 220)

    Write-Output "$([System.IO.Path]::GetFileName($srcPath)) seal=$($sealBBox -join ',') icon=$($iconBBox -join ',') caption=$($captionBBox -join ',')"

    $sealPiece    = [IconTool]::CropAndScale($bmp, $sealBBox[0], $sealBBox[1], $sealBBox[2], $sealBBox[3], 6, $sealScale)
    $iconPiece    = [IconTool]::CropAndScale($bmp, $iconBBox[0], $iconBBox[1], $iconBBox[2], $iconBBox[3], 4, $iconScale)
    $captionPiece = [IconTool]::CropAndScale($bmp, $captionBBox[0], $captionBBox[1], $captionBBox[2], $captionBBox[3], 4, $captionScale)

    $canvas = New-Object System.Drawing.Bitmap($w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
    [IconTool]::FillBg($canvas, $bgColor)

    # seal: pin close to the top-right corner
    $sealLeft = $w - $sealMarginRight - $sealPiece.Width
    $sealTop  = $sealMarginTop
    [IconTool]::DrawAt($canvas, $sealPiece, $sealLeft, $sealTop)

    # icon + caption: stack as a group, vertically centered on the original block's center
    $gap = 45
    $blockH = $iconPiece.Height + $gap + $captionPiece.Height
    $origBlockCenterY = [int]((($iconBBox[1]) + ($captionBBox[3])) / 2)
    $blockTop = $origBlockCenterY - [int]($blockH / 2)

    $iconLeft = [int](($w - $iconPiece.Width) / 2)
    $iconTop  = $blockTop
    [IconTool]::DrawAt($canvas, $iconPiece, $iconLeft, $iconTop)

    $capLeft = [int](($w - $captionPiece.Width) / 2)
    $capTop  = $iconTop + $iconPiece.Height + $gap
    [IconTool]::DrawAt($canvas, $captionPiece, $capLeft, $capTop)

    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved: $outPath"

    $bmp.Dispose(); $sealPiece.Dispose(); $iconPiece.Dispose(); $captionPiece.Dispose(); $canvas.Dispose()
}

$base = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\assets"
$preview = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview"

Process-Icon -srcPath "$base\微信专线.png" -outPath "$preview\微信专线.png" -sealScale 1.3 -iconScale 1.3 -captionScale 1.3 -sealMarginTop 45 -sealMarginRight 45

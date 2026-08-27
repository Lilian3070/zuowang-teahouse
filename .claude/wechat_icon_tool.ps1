Add-Type -AssemblyName System.Drawing

$base = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站"
$wechatIconPath = "$base\寻访茗舍\联系我们图标\微信专线.png"
$phoneIconPath  = "$base\寻访茗舍\联系我们图标\咨询热线.png"
$houseIconPath  = "$base\寻访茗舍\联系我们图标\茗舍地址.png"
$qrPath         = "$base\assets\微信二维码.jpg"
$outPath        = "$base\assets\微信专线.png"

Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class ImgTool
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

    public static Bitmap ResizeHQ(Bitmap src, int w, int h)
    {
        Bitmap result = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(result))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, w, h);
        }
        return result;
    }

    // Flood fill from the four borders across near-white pixels, replacing with bg color.
    // Stops at dark boundary pixels (the QR modules / icon outline), so enclosed white
    // pixels (like inside the wechat glyph) are left untouched.
    public static Bitmap FloodReplaceBackground(Bitmap src, int whiteThreshold, Color bg)
    {
        int w = src.Width, h = src.Height;
        Bitmap outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);

        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData srcData = src.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData outData = outBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int stride = srcData.Stride;
        byte[] srcBuf = new byte[stride * h];
        byte[] outBuf = new byte[stride * h];
        Marshal.Copy(srcData.Scan0, srcBuf, 0, srcBuf.Length);
        Array.Copy(srcBuf, outBuf, srcBuf.Length);
        src.UnlockBits(srcData);

        bool[] visited = new bool[w * h];
        Queue<int> qx = new Queue<int>();
        Queue<int> qy = new Queue<int>();

        for (int x = 0; x < w; x++) { qx.Enqueue(x); qy.Enqueue(0); qx.Enqueue(x); qy.Enqueue(h-1); }
        for (int y = 0; y < h; y++) { qx.Enqueue(0); qy.Enqueue(y); qx.Enqueue(w-1); qy.Enqueue(y); }

        byte bgB = bg.B, bgG = bg.G, bgR = bg.R;

        while (qx.Count > 0)
        {
            int x = qx.Dequeue();
            int y = qy.Dequeue();
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            int pi = y * w + x;
            if (visited[pi]) continue;
            int idx = y * stride + x * 4;
            byte b = srcBuf[idx]; byte g = srcBuf[idx+1]; byte r = srcBuf[idx+2];
            int brightness = (r + g + b) / 3;
            if (brightness < whiteThreshold) { visited[pi] = true; continue; }
            visited[pi] = true;
            outBuf[idx] = bgB; outBuf[idx+1] = bgG; outBuf[idx+2] = bgR; outBuf[idx+3] = 255;
            qx.Enqueue(x+1); qy.Enqueue(y);
            qx.Enqueue(x-1); qy.Enqueue(y);
            qx.Enqueue(x); qy.Enqueue(y+1);
            qx.Enqueue(x); qy.Enqueue(y-1);
        }

        Marshal.Copy(outBuf, 0, outData.Scan0, outBuf.Length);
        outBmp.UnlockBits(outData);
        return outBmp;
    }

    public static void FillRect(Bitmap bmp, Rectangle r, Color c)
    {
        using (Graphics g = Graphics.FromImage(bmp))
        {
            using (SolidBrush br = new SolidBrush(c))
            {
                g.FillRectangle(br, r);
            }
        }
    }

    public static void DrawCentered(Bitmap canvas, Bitmap piece, int centerX, int centerY)
    {
        using (Graphics g = Graphics.FromImage(canvas))
        {
            int x = centerX - piece.Width / 2;
            int y = centerY - piece.Height / 2;
            g.DrawImage(piece, x, y, piece.Width, piece.Height);
        }
    }
}
"@

# 1) Sample background color from a safe corner of the template
$wechatBmp = New-Object System.Drawing.Bitmap($wechatIconPath)
$bgPx = [ImgTool]::GetPixel($wechatBmp, 20, 20)
$bgColor = [System.Drawing.Color]::FromArgb($bgPx[0], $bgPx[1], $bgPx[2])
Write-Output "Background color: R=$($bgPx[0]) G=$($bgPx[1]) B=$($bgPx[2])"

# 2) Find bounding boxes of the phone / house icon glyphs (restricted to central icon zone, excluding seal + caption)
$phoneBmp = New-Object System.Drawing.Bitmap($phoneIconPath)
$houseBmp = New-Object System.Drawing.Bitmap($houseIconPath)
$searchX0 = 100; $searchY0 = 400; $searchX1 = 1400; $searchY1 = 1100
$threshold = 200

$phoneBBox = [ImgTool]::GetBBox($phoneBmp, $searchX0, $searchY0, $searchX1, $searchY1, $threshold)
$houseBBox = [ImgTool]::GetBBox($houseBmp, $searchX0, $searchY0, $searchX1, $searchY1, $threshold)
$cloudBBox = [ImgTool]::GetBBox($wechatBmp, $searchX0, $searchY0, $searchX1, $searchY1, $threshold)

Write-Output "Phone bbox: $($phoneBBox -join ',')"
Write-Output "House bbox: $($houseBBox -join ',')"
Write-Output "Cloud bbox: $($cloudBBox -join ',')"

$phoneW = $phoneBBox[2] - $phoneBBox[0]; $phoneH = $phoneBBox[3] - $phoneBBox[1]
$houseW = $houseBBox[2] - $houseBBox[0]; $houseH = $houseBBox[3] - $houseBBox[1]
$phoneMax = [Math]::Max($phoneW, $phoneH)
$houseMax = [Math]::Max($houseW, $houseH)
$targetSize = [int](([double]$phoneMax + [double]$houseMax) / 2.0)
Write-Output "Target QR size: $targetSize"

$cloudCenterX = [int](($cloudBBox[0] + $cloudBBox[2]) / 2)
$cloudCenterY = [int](($cloudBBox[1] + $cloudBBox[3]) / 2)
Write-Output "Cloud center: $cloudCenterX, $cloudCenterY"

# 3) Resize the QR down to target size, then flood-fill its white background to match bg color
$qrBmp = New-Object System.Drawing.Bitmap($qrPath)
$qrResized = [ImgTool]::ResizeHQ($qrBmp, $targetSize, $targetSize)
$qrRecolored = [ImgTool]::FloodReplaceBackground($qrResized, 235, $bgColor)

# 4) Erase the cloud icon area on a copy of the template, then composite the QR in its place
$finalBmp = New-Object System.Drawing.Bitmap($wechatBmp)
$pad = 20
$eraseRect = New-Object System.Drawing.Rectangle(($cloudBBox[0]-$pad), ($cloudBBox[1]-$pad), (($cloudBBox[2]-$cloudBBox[0])+2*$pad), (($cloudBBox[3]-$cloudBBox[1])+2*$pad))
[ImgTool]::FillRect($finalBmp, $eraseRect, $bgColor)
[ImgTool]::DrawCentered($finalBmp, $qrRecolored, $cloudCenterX, $cloudCenterY)

$finalBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Saved: $outPath"

$wechatBmp.Dispose(); $phoneBmp.Dispose(); $houseBmp.Dispose(); $qrBmp.Dispose()
$qrResized.Dispose(); $qrRecolored.Dispose(); $finalBmp.Dispose()

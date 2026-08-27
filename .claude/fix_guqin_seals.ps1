Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class SealTool
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
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, w, h);
        }
        return result;
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

function Fix-Seal {
    param(
        [string]$srcPath,
        [string]$outPath
    )

    $bmp = New-Object System.Drawing.Bitmap($srcPath)
    $w = $bmp.Width; $h = $bmp.Height

    $searchX0 = [int]($w * 0.5); $searchY0 = 0; $searchX1 = $w; $searchY1 = [int]($h * 0.35)
    $bbox = [SealTool]::GetRedBBox($bmp, $searchX0, $searchY0, $searchX1, $searchY1)
    $bx0=$bbox[0]; $by0=$bbox[1]; $bx1=$bbox[2]; $by1=$bbox[3]
    $bw = $bx1 - $bx0; $bh = $by1 - $by0
    Write-Output "$([System.IO.Path]::GetFileName($srcPath)) old seal bbox: $($bbox -join ',') size=${bw}x${bh}"

    # crop the existing seal (red box + glyph), with a little padding so the glyph isn't clipped
    $cropPad = 4
    $ccx0 = $bx0 - $cropPad; $ccy0 = $by0 - $cropPad
    $ccw = $bw + 2*$cropPad; $cch = $bh + 2*$cropPad
    $sealCrop = [SealTool]::CropRegion($bmp, $ccx0, $ccy0, $ccw, $cch)

    # erase a generously padded area (covers any soft shadow/glow around the old seal)
    $erasePad = 16
    $ex0 = $bx0 - $erasePad; $ey0 = $by0 - $erasePad
    $ew = $bw + 2*$erasePad; $eh = $bh + 2*$erasePad
    if ($ex0 -lt 0) { $ex0 = 0 }
    if ($ey0 -lt 0) { $ey0 = 0 }

    # sample a same-size patch of clean background just to the left of the erase area
    $patchX0 = $ex0 - $ew - 20
    if ($patchX0 -lt 0) { $patchX0 = 0 }
    $patch = [SealTool]::CropRegion($bmp, $patchX0, $ey0, $ew, $eh)

    $canvas = New-Object System.Drawing.Bitmap($bmp)
    [SealTool]::DrawAt($canvas, $patch, $ex0, $ey0)

    # target size/position matches the teaware seals' proportion on their 1500x1500 canvas:
    # bbox (1125,150)-(1293,318) -> left 0.75, top 0.10, size 0.112 of canvas width
    $targetSize = [int]([Math]::Round($w * 0.112))
    $targetX = [int]([Math]::Round($w * 0.75))
    $targetY = [int]([Math]::Round($h * 0.10))

    $sealResized = [SealTool]::ResizeHQ($sealCrop, $targetSize, $targetSize)
    [SealTool]::DrawAt($canvas, $sealResized, $targetX, $targetY)

    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved: $outPath"

    $bmp.Dispose(); $sealCrop.Dispose(); $patch.Dispose(); $canvas.Dispose(); $sealResized.Dispose()
}

$base = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\斫琴甄选\斫琴甄选分类图标"
$preview = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview"
New-Item -ItemType Directory -Force -Path $preview | Out-Null

foreach ($name in @("初弦","妙音","藏锋","携行")) {
  Fix-Seal -srcPath "$base\$name.png" -outPath "$preview\$name.png"
}

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class SealGen
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

    public static int[] GetPixel(Bitmap bmp, int x, int y)
    {
        Color c = bmp.GetPixel(x, y);
        return new int[] { c.R, c.G, c.B };
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
}
"@

$tealAsset = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\assets\茶器-泡茶主器.png"
$tea = New-Object System.Drawing.Bitmap($tealAsset)
$bbox = [SealGen]::GetRedBBox($tea, 1000, 0, 1500, 400)
Write-Output "Teaware seal bbox: $($bbox -join ',')"
$px = [SealGen]::GetPixel($tea, ($bbox[0]+8), ($bbox[1]+8))
Write-Output "Sampled red: R=$($px[0]) G=$($px[1]) B=$($px[2])"
$tea.Dispose()

$redColor = [System.Drawing.Color]::FromArgb($px[0], $px[1], $px[2])
$whiteColor = [System.Drawing.Color]::FromArgb(255,255,255,255)

# quick test render at high-res, one character, to eyeball proportions first
$test = [SealGen]::CreateSeal("藏", 400, $redColor, $whiteColor, "Microsoft YaHei", 0.5, 0.028, 0.16)
$test.Save("C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview\test_seal_cang.png", [System.Drawing.Imaging.ImageFormat]::Png)
$test2 = [SealGen]::CreateSeal("妙", 400, $redColor, $whiteColor, "Microsoft YaHei", 0.5, 0.028, 0.16)
$test2.Save("C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview\test_seal_miao.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Saved test seals"

function Fix-GuqinSeal {
    param(
        [string]$srcPath,
        [string]$outPath,
        [string]$char
    )

    $bmp = New-Object System.Drawing.Bitmap($srcPath)
    $w = $bmp.Width; $h = $bmp.Height

    $searchX0 = [int]($w * 0.5); $searchY0 = 0; $searchX1 = $w; $searchY1 = [int]($h * 0.35)
    $bbox = [SealGen]::GetRedBBox($bmp, $searchX0, $searchY0, $searchX1, $searchY1)
    $bx0=$bbox[0]; $by0=$bbox[1]; $bx1=$bbox[2]; $by1=$bbox[3]
    $bw = $bx1 - $bx0; $bh = $by1 - $by0

    # erase a generously padded area to remove the old seal plus any soft glow
    $erasePad = 16
    $ex0 = $bx0 - $erasePad; $ey0 = $by0 - $erasePad
    $ew = $bw + 2*$erasePad; $eh = $bh + 2*$erasePad
    if ($ex0 -lt 0) { $ex0 = 0 }
    if ($ey0 -lt 0) { $ey0 = 0 }

    $patchX0 = $ex0 - $ew - 20
    if ($patchX0 -lt 0) { $patchX0 = 0 }
    $patchBmp = New-Object System.Drawing.Bitmap($ew, $eh)
    $gp = [System.Drawing.Graphics]::FromImage($patchBmp)
    $gp.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0,0,$ew,$eh)), (New-Object System.Drawing.Rectangle($patchX0,$ey0,$ew,$eh)), [System.Drawing.GraphicsUnit]::Pixel)
    $gp.Dispose()

    $canvas = New-Object System.Drawing.Bitmap($bmp)
    $gc = [System.Drawing.Graphics]::FromImage($canvas)
    $gc.DrawImage($patchBmp, $ex0, $ey0, $ew, $eh)

    # fresh crisp hollow seal, built high-res then downsized for clean antialiasing
    $targetSize = [int]([Math]::Round($w * 0.095))
    $targetX = [int]([Math]::Round($w * 0.767))
    $targetY = [int]([Math]::Round($h * 0.10))
    $sealHiRes = [SealGen]::CreateSeal($char, 400, $script:redColor, $script:whiteColor, "Microsoft YaHei", 0.5, 0.028, 0.16)
    $sealFinal = [SealGen]::ResizeHQ($sealHiRes, $targetSize, $targetSize)
    $gc.DrawImage($sealFinal, $targetX, $targetY, $targetSize, $targetSize)
    $gc.Dispose()

    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved: $outPath"

    $bmp.Dispose(); $patchBmp.Dispose(); $canvas.Dispose(); $sealHiRes.Dispose(); $sealFinal.Dispose()
}

$guqinBase = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\斫琴甄选\斫琴甄选分类图标"
$previewDir = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\.claude\preview"

Fix-GuqinSeal -srcPath "$guqinBase\初弦.png" -outPath "$previewDir\初弦.png" -char "初"
Fix-GuqinSeal -srcPath "$guqinBase\妙音.png" -outPath "$previewDir\妙音.png" -char "妙"
Fix-GuqinSeal -srcPath "$guqinBase\藏锋.png" -outPath "$previewDir\藏锋.png" -char "藏"
Fix-GuqinSeal -srcPath "$guqinBase\携行.png" -outPath "$previewDir\携行.png" -char "行"

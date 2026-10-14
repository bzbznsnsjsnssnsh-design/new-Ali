// Advanced Manga Colorizer
// Uses an AI image-to-image / colorization backend with a fallback to a vibrant atmospheric filter.

export async function colorizeImageAPI(imageUrl: string, options?: any): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    const proxyUrl = imageUrl.startsWith("/api/")
      ? imageUrl
      : `/api/manga/image?url=${encodeURIComponent(imageUrl)}`;

    img.onload = async () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          resolve(imageUrl);
          return;
        }

        const MAX_DIM = 1200;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const base64Image = canvas.toDataURL("image/jpeg", 0.85);

        try {
          const response = await fetch("/api/manga/colorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64Image }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.colorizedImage) {
              const colorImg = new Image();
              colorImg.crossOrigin = "Anonymous";
              colorImg.onload = () => {
                const finalCanvas = document.createElement("canvas");
                finalCanvas.width = img.width;
                finalCanvas.height = img.height;
                const finalCtx = finalCanvas.getContext("2d");
                if (finalCtx) {
                  finalCtx.drawImage(img, 0, 0);
                  finalCtx.globalCompositeOperation = "color";
                  finalCtx.drawImage(colorImg, 0, 0, img.width, img.height);
                  resolve(finalCanvas.toDataURL("image/jpeg", 0.9));
                } else {
                  resolve(data.colorizedImage);
                }
              };
              colorImg.onerror = () => resolve(data.colorizedImage);
              colorImg.src = data.colorizedImage;
              return;
            }
          }
        } catch (apiErr) {
          console.warn("Backend AI colorization failed, using smart heuristic fallback:", apiErr);
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;

          if (luma > 240 || luma < 15) continue;

          if (luma < 85) {
            data[i] = Math.max(0, luma * 0.75);
            data[i + 1] = Math.max(0, luma * 0.85);
            data[i + 2] = Math.min(255, luma * 1.35 + 20);
          } else if (luma < 190) {
            const t = (luma - 85) / 105;
            const shadowR = luma * 0.75;
            const shadowG = luma * 0.85;
            const shadowB = luma * 1.35 + 20;

            const midR = Math.min(255, luma * 1.25 + 15);
            const midG = Math.min(255, luma * 0.98 + 5);
            const midB = Math.max(0, luma * 0.75 - 10);

            data[i] = shadowR * (1 - t) + midR * t;
            data[i + 1] = shadowG * (1 - t) + midG * t;
            data[i + 2] = shadowB * (1 - t) + midB * t;
          } else {
            const t = (luma - 190) / 50;
            const midR = Math.min(255, luma * 1.25 + 15);
            const midG = Math.min(255, luma * 0.98 + 5);
            const midB = Math.max(0, luma * 0.75 - 10);

            const highR = Math.min(255, luma * 1.08 + 10);
            const highG = Math.min(255, luma * 1.03 + 5);
            const highB = Math.max(0, luma * 0.88);

            data[i] = midR * (1 - t) + highR * t;
            data[i + 1] = midG * (1 - t) + highG * t;
            data[i + 2] = midB * (1 - t) + highB * t;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        console.error("Colorization failed (CORS or canvas error):", e);
        resolve(imageUrl);
      }
    };

    img.onerror = () => {
      resolve(imageUrl);
    };

    img.src = proxyUrl;
  });
}

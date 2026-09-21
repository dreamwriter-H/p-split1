(function (global) {
    'use strict';

    const LEFT_QR_PATTERN = /^[A-Z]{2}\d{8}\d{7}[\d ]{4}[0-9A-Fa-f]{16}/;
    const RIGHT_QR_PATTERN = /^\*\*/;
    const MAX_SCAN_ATTEMPTS = 18;
    const DEFAULT_MAX_PIXELS = 2200000;

    const normalizeCode = (value) => String(value || '')
        .replace(/^[\u0000-\u001f\u007f-\u009f\uFEFF]+/, '')
        .trim();

    const classifyCode = (value) => {
        const code = normalizeCode(value);
        if (LEFT_QR_PATTERN.test(code)) return 'left';
        if (RIGHT_QR_PATTERN.test(code)) return 'right';
        return 'other';
    };

    const hasInvoicePair = (codes) => {
        const types = new Set(codes.map(classifyCode));
        return types.has('left') && types.has('right');
    };

    const appendUnique = (target, values) => {
        const added = [];
        values.forEach(value => {
            const code = normalizeCode(value);
            if (code && !target.includes(code)) {
                target.push(code);
                added.push(code);
            }
        });
        return added;
    };

    const nextFrame = () => new Promise(resolve => global.setTimeout(resolve, 0));

    const loadImage = async (file) => {
        if (!file || !String(file.type || '').startsWith('image/')) {
            throw new Error('請選擇發票照片。');
        }

        if (typeof global.createImageBitmap === 'function') {
            try {
                const bitmap = await global.createImageBitmap(file, { imageOrientation: 'from-image' });
                return {
                    source: bitmap,
                    width: bitmap.width,
                    height: bitmap.height,
                    dispose: () => bitmap.close?.()
                };
            } catch (error) {
                console.warn('createImageBitmap 無法讀取照片，改用圖片元件：', error);
            }
        }

        const objectUrl = global.URL.createObjectURL(file);
        const image = new Image();
        image.decoding = 'async';
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('照片載入失敗，請重新拍攝。'));
            image.src = objectUrl;
        });
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            dispose: () => global.URL.revokeObjectURL(objectUrl)
        };
    };

    // Every crop is rendered directly from the original photo. This intentionally avoids
    // the old two-step "whole photo downscale, then crop" path which erased dense right-QR modules.
    const buildCropPlans = () => [
        { label: '完整照片快速定位', x: 0, y: 0, width: 1, height: 1, maxSide: 1800, minShortSide: 760, maxPixels: 1700000, variants: ['original'] },
        { label: '下方高解析區域', x: 0, y: 0.38, width: 1, height: 0.62, maxSide: 2200, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '中段高解析區域', x: 0, y: 0.18, width: 1, height: 0.64, maxSide: 2200, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '左下高解析區域', x: 0, y: 0.56, width: 0.58, height: 0.44, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '右下高解析區域', x: 0.42, y: 0.56, width: 0.58, height: 0.44, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '左中高解析區域', x: 0, y: 0.28, width: 0.58, height: 0.46, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '右中高解析區域', x: 0.42, y: 0.28, width: 0.58, height: 0.46, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '左上高解析區域', x: 0, y: 0, width: 0.58, height: 0.46, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] },
        { label: '右上高解析區域', x: 0.42, y: 0, width: 0.58, height: 0.46, maxSide: 1800, minShortSide: 1050, variants: ['original', 'contrast'] }
    ];

    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

    const resolveCropRect = (plan, sourceWidth, sourceHeight) => {
        const pixelUnits = plan.units === 'pixels';
        const requestedX = pixelUnits ? plan.x : sourceWidth * plan.x;
        const requestedY = pixelUnits ? plan.y : sourceHeight * plan.y;
        const requestedWidth = pixelUnits ? plan.width : sourceWidth * plan.width;
        const requestedHeight = pixelUnits ? plan.height : sourceHeight * plan.height;
        const x = clamp(Math.floor(requestedX), 0, Math.max(0, sourceWidth - 1));
        const y = clamp(Math.floor(requestedY), 0, Math.max(0, sourceHeight - 1));
        const width = clamp(Math.ceil(requestedWidth), 1, sourceWidth - x);
        const height = clamp(Math.ceil(requestedHeight), 1, sourceHeight - y);
        return { x, y, width, height };
    };

    const chooseRenderSize = (rect, plan) => {
        const longest = Math.max(rect.width, rect.height);
        const shortest = Math.max(1, Math.min(rect.width, rect.height));
        const maxSide = plan.maxSide || 1800;
        const minShortSide = plan.minShortSide || 900;
        const maxPixels = plan.maxPixels || DEFAULT_MAX_PIXELS;
        const desiredScale = Math.max(1, minShortSide / shortest);
        const allowedScale = Math.min(2.5, maxSide / longest, Math.sqrt(maxPixels / (rect.width * rect.height)));
        const scale = Math.max(0.05, Math.min(desiredScale, allowedScale));
        return {
            width: Math.max(1, Math.round(rect.width * scale)),
            height: Math.max(1, Math.round(rect.height * scale))
        };
    };

    const renderCrop = (source, sourceWidth, sourceHeight, plan, rotation = 0) => {
        const rect = resolveCropRect(plan, sourceWidth, sourceHeight);
        const renderSize = chooseRenderSize(rect, plan);
        const normalizedRotation = ((rotation % 360) + 360) % 360;
        const swapDimensions = normalizedRotation === 90 || normalizedRotation === 270;
        const canvas = document.createElement('canvas');
        canvas.width = swapDimensions ? renderSize.height : renderSize.width;
        canvas.height = swapDimensions ? renderSize.width : renderSize.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const isDownscaling = renderSize.width < rect.width || renderSize.height < rect.height;
        context.imageSmoothingEnabled = isDownscaling;
        if (isDownscaling) context.imageSmoothingQuality = 'high';

        if (normalizedRotation === 90) {
            context.translate(canvas.width, 0);
            context.rotate(Math.PI / 2);
        } else if (normalizedRotation === 180) {
            context.translate(canvas.width, canvas.height);
            context.rotate(Math.PI);
        } else if (normalizedRotation === 270) {
            context.translate(0, canvas.height);
            context.rotate(-Math.PI / 2);
        }

        context.drawImage(
            source,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            renderSize.width,
            renderSize.height
        );
        return { canvas, rect, renderSize, rotation: normalizedRotation };
    };

    const maskResult = (imageData, result) => {
        const location = result?.location;
        if (!location) return;
        const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner].filter(Boolean);
        if (!points.length) return;
        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        const qrSize = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        // A small padding removes the decoded finder patterns without whitening the adjacent QR.
        const padding = Math.max(6, Math.round(qrSize * 0.07));
        const startX = Math.max(0, Math.floor(Math.min(...xs) - padding));
        const endX = Math.min(imageData.width, Math.ceil(Math.max(...xs) + padding));
        const startY = Math.max(0, Math.floor(Math.min(...ys) - padding));
        const endY = Math.min(imageData.height, Math.ceil(Math.max(...ys) + padding));
        for (let y = startY; y < endY; y += 1) {
            for (let x = startX; x < endX; x += 1) {
                const offset = (y * imageData.width + x) * 4;
                imageData.data[offset] = 255;
                imageData.data[offset + 1] = 255;
                imageData.data[offset + 2] = 255;
                imageData.data[offset + 3] = 255;
            }
        }
    };

    const increaseContrast = (source) => {
        const enhanced = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
        const histogram = new Uint32Array(256);
        let pixels = 0;
        for (let index = 0; index < enhanced.data.length; index += 16) {
            const gray = Math.round(enhanced.data[index] * 0.299 + enhanced.data[index + 1] * 0.587 + enhanced.data[index + 2] * 0.114);
            histogram[gray] += 1;
            pixels += 1;
        }
        const lowerTarget = pixels * 0.025;
        const upperTarget = pixels * 0.975;
        let cumulative = 0;
        let low = 0;
        let high = 255;
        for (let value = 0; value < 256; value += 1) {
            cumulative += histogram[value];
            if (cumulative >= lowerTarget) { low = value; break; }
        }
        cumulative = 0;
        for (let value = 0; value < 256; value += 1) {
            cumulative += histogram[value];
            if (cumulative >= upperTarget) { high = value; break; }
        }
        if (high - low < 50) {
            low = Math.max(0, low - 25);
            high = Math.min(255, high + 25);
        }
        const range = Math.max(1, high - low);
        for (let index = 0; index < enhanced.data.length; index += 4) {
            const gray = enhanced.data[index] * 0.299 + enhanced.data[index + 1] * 0.587 + enhanced.data[index + 2] * 0.114;
            const adjusted = clamp(Math.round((gray - low) * 255 / range), 0, 255);
            enhanced.data[index] = adjusted;
            enhanced.data[index + 1] = adjusted;
            enhanced.data[index + 2] = adjusted;
            enhanced.data[index + 3] = 255;
        }
        return enhanced;
    };

    const applyOtsuThreshold = (source) => {
        const thresholded = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
        const histogram = new Uint32Array(256);
        let total = 0;
        let weightedTotal = 0;
        for (let index = 0; index < thresholded.data.length; index += 16) {
            const value = thresholded.data[index];
            histogram[value] += 1;
            total += 1;
            weightedTotal += value;
        }
        let backgroundWeight = 0;
        let backgroundSum = 0;
        let bestVariance = -1;
        let threshold = 128;
        for (let value = 0; value < 256; value += 1) {
            backgroundWeight += histogram[value];
            if (!backgroundWeight) continue;
            const foregroundWeight = total - backgroundWeight;
            if (!foregroundWeight) break;
            backgroundSum += value * histogram[value];
            const backgroundMean = backgroundSum / backgroundWeight;
            const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
            const variance = backgroundWeight * foregroundWeight * Math.pow(backgroundMean - foregroundMean, 2);
            if (variance > bestVariance) {
                bestVariance = variance;
                threshold = value;
            }
        }
        threshold = clamp(threshold, 55, 215);
        for (let index = 0; index < thresholded.data.length; index += 4) {
            const value = thresholded.data[index] < threshold ? 0 : 255;
            thresholded.data[index] = value;
            thresholded.data[index + 1] = value;
            thresholded.data[index + 2] = value;
            thresholded.data[index + 3] = 255;
        }
        return thresholded;
    };

    const createVariant = (sourceImageData, variant) => {
        if (variant === 'contrast') return increaseContrast(sourceImageData);
        if (variant === 'threshold') return applyOtsuThreshold(increaseContrast(sourceImageData));
        return new ImageData(new Uint8ClampedArray(sourceImageData.data), sourceImageData.width, sourceImageData.height);
    };

    const decodeImageData = (sourceImageData, variants) => {
        const detections = [];
        const decode = imageData => global.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
        for (const variant of variants) {
            const working = createVariant(sourceImageData, variant);
            for (let pass = 0; pass < 3; pass += 1) {
                const result = decode(working);
                if (!result?.data) break;
                const code = normalizeCode(result.data);
                if (code && !detections.some(item => item.data === code)) {
                    detections.push({ data: code, type: classifyCode(code), location: result.location, variant });
                }
                maskResult(working, result);
            }
        }
        return detections;
    };

    const inverseRotatePoint = (point, rendered) => {
        const width = rendered.renderSize.width;
        const height = rendered.renderSize.height;
        if (rendered.rotation === 90) return { x: point.y, y: height - point.x };
        if (rendered.rotation === 180) return { x: width - point.x, y: height - point.y };
        if (rendered.rotation === 270) return { x: width - point.y, y: point.x };
        return { x: point.x, y: point.y };
    };

    const locationToSourceBox = (location, rendered) => {
        if (!location) return null;
        const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner]
            .filter(Boolean)
            .map(point => inverseRotatePoint(point, rendered));
        if (!points.length) return null;
        const xs = points.map(point => rendered.rect.x + point.x / rendered.renderSize.width * rendered.rect.width);
        const ys = points.map(point => rendered.rect.y + point.y / rendered.renderSize.height * rendered.rect.height);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
    };

    const buildGuidedCropPlans = (detection, sourceWidth, sourceHeight) => {
        const box = detection?.sourceBox;
        if (!box) return [];
        const qrSize = Math.max(box.width, box.height);
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const cropSize = Math.max(180, qrSize * 2.7);
        const rowWidth = Math.max(cropSize * 2.3, qrSize * 6.2);
        const createPlan = (label, x, y, width, height) => {
            const startX = clamp(x, 0, Math.max(0, sourceWidth - 1));
            const startY = clamp(y, 0, Math.max(0, sourceHeight - 1));
            return {
                label,
                units: 'pixels',
                x: startX,
                y: startY,
                width: clamp(width, 1, sourceWidth - startX),
                height: clamp(height, 1, sourceHeight - startY),
                maxSide: 1900,
                minShortSide: 1200,
                maxPixels: 2600000,
                variants: ['original', 'contrast', 'threshold'],
                guided: true
            };
        };
        return [
            createPlan('同高度右側 QR 精細搜尋', centerX + qrSize * 0.25, centerY - cropSize / 2, cropSize, cropSize),
            createPlan('同高度左側 QR 精細搜尋', centerX - qrSize * 0.25 - cropSize, centerY - cropSize / 2, cropSize, cropSize),
            createPlan('同高度左右 QR 完整搜尋', centerX - rowWidth / 2, centerY - cropSize * 0.58, rowWidth, cropSize * 1.16)
        ];
    };

    const scanPreparedSource = async (source, sourceWidth, sourceHeight, options = {}) => {
        if (typeof global.jsQR !== 'function') throw new Error('QR 辨識元件尚未載入，請確認網路後重新開啟頁面。');
        const closeupMode = options.mode === 'closeup';
        const plans = closeupMode ? [{
            label: '單一 QR 特寫高解析',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            maxSide: 2200,
            minShortSide: 1400,
            maxPixels: 2800000,
            variants: ['original', 'contrast', 'threshold']
        }] : buildCropPlans();
        const maxAttempts = closeupMode ? 4 : MAX_SCAN_ATTEMPTS;
        const codes = [];
        const detections = [];
        const strategiesTried = [];
        const guidedTypes = new Set();
        let attempts = 0;
        let bestStrategy = '';

        const publishProgress = (label) => {
            options.onProgress?.({
                current: attempts,
                total: maxAttempts,
                label,
                codes: [...codes],
                foundLeft: codes.some(code => classifyCode(code) === 'left'),
                foundRight: codes.some(code => classifyCode(code) === 'right')
            });
        };

        const scanPlan = async (plan, rotation = 0) => {
            if (attempts >= maxAttempts || hasInvoicePair(codes)) return [];
            attempts += 1;
            const label = `${plan.label}${rotation ? `（旋轉 ${rotation}°）` : ''}`;
            strategiesTried.push(label);
            publishProgress(label);
            const rendered = renderCrop(source, sourceWidth, sourceHeight, plan, rotation);
            try {
                const context = rendered.canvas.getContext('2d', { willReadFrequently: true });
                const imageData = context.getImageData(0, 0, rendered.canvas.width, rendered.canvas.height);
                const found = decodeImageData(imageData, plan.variants || ['original']);
                const newCodes = appendUnique(codes, found.map(item => item.data));
                const mapped = found.map(item => ({
                    ...item,
                    sourceBox: locationToSourceBox(item.location, rendered),
                    strategy: label
                }));
                detections.push(...mapped);
                if (newCodes.some(code => classifyCode(code) !== 'other')) bestStrategy = label;
                return mapped;
            } finally {
                rendered.canvas.width = 1;
                rendered.canvas.height = 1;
            }
        };

        const scanGuidedFrom = async (detection) => {
            if (closeupMode || !detection || detection.type === 'other' || guidedTypes.has(detection.type)) return;
            guidedTypes.add(detection.type);
            const guidedPlans = buildGuidedCropPlans(detection, sourceWidth, sourceHeight);
            for (const plan of guidedPlans) {
                await scanPlan(plan);
                if (hasInvoicePair(codes)) break;
                await nextFrame();
            }
        };

        for (const plan of plans) {
            const found = await scanPlan(plan);
            if (hasInvoicePair(codes)) break;
            const invoiceDetection = found.find(item => item.type === 'left' || item.type === 'right');
            if (invoiceDetection) await scanGuidedFrom(invoiceDetection);
            if (hasInvoicePair(codes)) break;
            await nextFrame();
        }

        // Rotation is a bounded last-resort pass. jsQR is normally rotation-independent,
        // but camera orientation metadata and raster rounding can still change finder detection.
        if (!hasInvoicePair(codes) && attempts < maxAttempts) {
            const anchor = detections.find(item => item.type === 'left' || item.type === 'right');
            const fallbackPlan = closeupMode
                ? { ...plans[0], label: '單一 QR 方向備援', variants: ['original', 'contrast'] }
                : anchor
                    ? buildGuidedCropPlans(anchor, sourceWidth, sourceHeight).slice(-1)[0]
                    : { ...plans[0], label: '完整照片方向備援', variants: ['original', 'contrast'] };
            if (fallbackPlan) {
                for (const rotation of [90, 180, 270]) {
                    await scanPlan(fallbackPlan, rotation);
                    if (hasInvoicePair(codes)) break;
                    await nextFrame();
                }
            }
        }

        publishProgress(hasInvoicePair(codes) ? '左右 QR 辨識完成' : '掃描完成');
        return {
            codes,
            attempts,
            totalPlans: maxAttempts,
            foundLeft: codes.some(code => classifyCode(code) === 'left'),
            foundRight: codes.some(code => classifyCode(code) === 'right'),
            foundPair: hasInvoicePair(codes),
            bestStrategy,
            strategiesTried
        };
    };

    const scanCanvas = async (sourceCanvas, options = {}) => scanPreparedSource(
        sourceCanvas,
        sourceCanvas.width,
        sourceCanvas.height,
        options
    );

    const scanFile = async (file, options = {}) => {
        const loaded = await loadImage(file);
        try {
            return await scanPreparedSource(loaded.source, loaded.width, loaded.height, options);
        } finally {
            loaded.dispose();
        }
    };

    global.SplitEasyInvoiceImageScanner = Object.freeze({
        scanFile,
        scanCanvas,
        classifyCode,
        buildCropPlans,
        normalizeCode
    });
})(window);

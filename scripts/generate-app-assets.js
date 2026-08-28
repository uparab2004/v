const Jimp = require('jimp-compact');

const SCALE = 2;
const size = 1024 * SCALE;
const rgba = (red, green, blue, alpha = 255) => Jimp.rgbaToInt(red, green, blue, alpha);
const primary = rgba(21, 148, 71);
const background = rgba(246, 251, 248);
const white = rgba(255, 255, 255);
const transparent = rgba(0, 0, 0, 0);

const createImage = (width, height, color) => new Promise((resolve, reject) => {
  new Jimp(width, height, color, (error, image) => error ? reject(error) : resolve(image));
});

const fillRoundedRect = (image, left, top, width, height, radius, color) => {
  image.scan(left, top, width, height, function scan(x, y, index) {
    const nearestX = Math.max(left + radius, Math.min(x, left + width - radius - 1));
    const nearestY = Math.max(top + radius, Math.min(y, top + height - radius - 1));
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy <= radius * radius) this.bitmap.data.writeUInt32BE(color, index);
  });
};

const pointInPolygon = (x, y, points) => {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const currentPoint = points[current];
    const previousPoint = points[previous];
    const intersects = ((currentPoint[1] > y) !== (previousPoint[1] > y))
      && x < ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1]))
        / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
};

const fillPolygon = (image, points, color) => {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));
  image.scan(minX, minY, maxX - minX + 1, maxY - minY + 1, function scan(x, y, index) {
    if (pointInPolygon(x, y, points)) this.bitmap.data.writeUInt32BE(color, index);
  });
};

const fillCircle = (image, centerX, centerY, radius, color) => {
  const diameter = radius * 2;
  image.scan(centerX - radius, centerY - radius, diameter, diameter, function scan(x, y, index) {
    const dx = x - centerX;
    const dy = y - centerY;
    if (dx * dx + dy * dy <= radius * radius) this.bitmap.data.writeUInt32BE(color, index);
  });
};

const drawLine = (image, startX, startY, endX, endY, width, color) => {
  const steps = Math.ceil(Math.hypot(endX - startX, endY - startY));
  for (let step = 0; step <= steps; step += Math.max(1, Math.floor(width / 4))) {
    const ratio = step / steps;
    fillCircle(
      image,
      Math.round(startX + (endX - startX) * ratio),
      Math.round(startY + (endY - startY) * ratio),
      Math.round(width / 2),
      color,
    );
  }
};

const drawQuadratic = (image, start, control, end, width, color) => {
  let previous = start;
  for (let step = 1; step <= 80; step += 1) {
    const t = step / 80;
    const inverse = 1 - t;
    const point = [
      inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
      inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
    ];
    drawLine(image, previous[0], previous[1], point[0], point[1], width, color);
    previous = point;
  }
};

const drawMark = (image) => {
  const scale = SCALE;
  fillRoundedRect(image, 170 * scale, 170 * scale, 684 * scale, 684 * scale, 170 * scale, primary);

  drawQuadratic(
    image,
    [394 * scale, 445 * scale],
    [406 * scale, 315 * scale],
    [512 * scale, 315 * scale],
    38 * scale,
    white,
  );
  drawQuadratic(
    image,
    [512 * scale, 315 * scale],
    [618 * scale, 315 * scale],
    [630 * scale, 445 * scale],
    38 * scale,
    white,
  );

  const outerBasket = [[296, 430], [728, 430], [674, 690], [350, 690]]
    .map(([x, y]) => [x * scale, y * scale]);
  const innerBasket = [[350, 490], [674, 490], [642, 632], [382, 632]]
    .map(([x, y]) => [x * scale, y * scale]);
  fillPolygon(image, outerBasket, white);
  fillPolygon(image, innerBasket, primary);
  drawLine(image, 366 * scale, 548 * scale, 658 * scale, 548 * scale, 26 * scale, white);
  drawLine(image, 455 * scale, 475 * scale, 466 * scale, 652 * scale, 24 * scale, white);
  drawLine(image, 569 * scale, 475 * scale, 558 * scale, 652 * scale, 24 * scale, white);
};

const save = async (image, path, outputSize) => {
  image.resize(outputSize, outputSize, Jimp.RESIZE_BICUBIC);
  await image.writeAsync(path);
};

const main = async () => {
  const icon = await createImage(size, size, background);
  drawMark(icon);
  await save(icon, 'assets/icon.png', 1024);

  const adaptive = await createImage(size, size, transparent);
  drawMark(adaptive);
  await save(adaptive, 'assets/adaptive-icon.png', 1024);

  const storeIcon = await createImage(size, size, background);
  drawMark(storeIcon);
  await save(storeIcon, 'assets/play-store-icon.png', 512);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

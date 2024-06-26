// @ts-nocheck
// The entry file of your WebAssembly module.

declare function print(n: any): void;
declare function printString(n: String): void;
declare function printF64(n: f64): void;
declare function printI32(n: i32): void;

@inline
function myExp(x: f64): f64 {
    const terms: i32 = 100; // Number of terms in the Taylor series
    let result: f64 = 1.0;
    let factorial: f64 = 1.0;
    let power: f64 = x;

    for (let i: i32 = 1; i <= terms; ++i) {
        factorial *= <f64>i;
        result += power / factorial;
        power *= x;
    }

    return result;
}

/**
 * Calculates the value of the given function f(x, y) = (1 / (2 * pi * sigma^2)) * exp(-(x^2 + y^2) / (2 * sigma^2))
 * @param x The x value
 * @param y The y value
 * @param sigma The standard deviation
 * @returns The value of the function f(x, y)
 */
@inline
function getGauss(x: f64, y: f64, sigma: f64): f64 {
  const sigma2: f64 = sigma * sigma;
  const numerator: f64 = x * x + y * y;
  const exponent: f64 = -numerator / (2.0 * sigma2);
  const expValue: f64 = myExp(exponent);
  const result: f64 = expValue / (2.0 * Math.PI * sigma2);
  return result;
}

@inline
function getLaplacianOfGauss(x: f64, y: f64, sigma: f64): f64 {
  const numerator: f64 = x * x + y * y - 2;
  const denominator: f64 = sigma * sigma;
  const result: f64 = (numerator / denominator) * getGauss(x, y, sigma);
  return result;
}

/**
 * Inverts the colors of an image represented as RGBA byte array.
 * @param byteSize The size of the byte array
 * @returns 0
 */
export function negative(byteSize: i32): i32 {
  for (let i = 0; i < byteSize; i += 4) {
    let pos = i + byteSize;
    store<u8>(pos + 0, 255 - load<u8>(i + 0));
    store<u8>(pos + 1, 255 - load<u8>(i + 1));
    store<u8>(pos + 2, 255 - load<u8>(i + 2));
    store<u8>(pos + 3, 255);
  }
  return 0;
}

/**
 * Converts an image to grayscale.
 * @param byteSize The size of the byte array
 * @returns 0
 */
export function grayscale(byteSize: i32): i32 {
  for (let i = 0; i < byteSize; i += 4) {
    let pos = i + byteSize;
    const avg = u8(0.3 * load<u8>(i) + 0.59 * load<u8>(i + 1) + 0.11 * load<u8>(i + 2));
    store<u8>(pos + 0, avg);
    store<u8>(pos + 1, avg);
    store<u8>(pos + 2, avg);
    store<u8>(pos + 3, 255);
  }
  return 0;
}

/**
 * Gets the pixel position with cyclic boundary conditions.
 * @param pos The current position
 * @param length The length of the array
 * @param w The width of the image
 * @param h The height of the image
 * @returns The new position
 */
@inline
function _getPixelCyclic(pos: i32, w: i32, h: i32): i32 {
  const x: i32 = pos % w;
  const y: i32 = (pos / w) | 0; // using bitwise OR to perform floor division

  // handle x coordinate wrapping
  let newX: i32 = x;
  if (x < 0) {
    newX += w;
  } else if (x >= w) {
    newX -= w;
  }

  // handle y coordinate wrapping
  let newY: i32 = y;
  if (y < 0) {
    newY += h;
  } else if (y >= h) {
    newY -= h;
  }

  // return the new position in the array
  return newY * w + newX;
}

/**
 * Gets the pixel position with null boundary conditions.
 * @param pos The current position
 * @param length The length of the array
 * @param w The width of the image
 * @param h The height of the image
 * @returns The new position or -1 if out of bounds
 */
@inline
function _getPixelNull(pos: i32, w: i32, h: i32): i32 {
  const x: i32 = pos % w;
  const y: i32 = pos / w;

  if (x < 0 || x >= w || y < 0 || y >= h) {
    return -1;
  }

  return pos;
}

/**
 * Gets the pixel position with repeat boundary conditions.
 * @param pos The current position
 * @param length The length of the array
 * @param w The width of the image
 * @param h The height of the image
 * @returns The new position
 */
@inline
function _getPixelRepeat(pos: i32, w: i32, h: i32): i32 {
  const x: i32 = pos % w;
  const y: i32 = pos / w;

  const newX: i32 = (x + w) % w;
  const newY: i32 = (y + h) % h;

  return newY * w + newX;
}

/**
 * Gets the pixel position based on boundary condition mode.
 * @param pos The current position
 * @param length The length of the array
 * @param w The width of the image
 * @param h The height of the image
 * @param mode The mode for handling boundary conditions
 * @returns The new position
 */
@inline
function getPixelByMode(pos: i32, w: i32, h: i32, mode: i32): i32 {
  switch (mode) {
    case 0:
      return _getPixelCyclic(pos, w * 4, h);
    case 1:
      return _getPixelNull(pos, w * 4, h);
    case 2:
      return _getPixelRepeat(pos, w * 4, h);
    default:
      return _getPixelCyclic(pos, w * 4, h);
  }
}

/**
 * Helper function for the convolution operation.
 *
 * This function returns the value at the specified position `pos` in the array,
 * if the position is within the bounds of the array. If `pos` is out of bounds,
 * it it uses pixel mode to get pixel position instead. This is useful for handling edge cases
 * in the convolution operation where the kernel may extend beyond the bounds
 * of the array.
 *
 * @param pos - The position in the array to retrieve the value from
 * @param length - The length of the array
 * @param w - The width of the array
 * @param mode - The mode for handling out-of-bounds values (not used in this function)
 * @returns The value at the specified position `pos` in the array
 */
@inline
function addConvolveValue(pos: i32, length: i32, w: i32, h: i32, mode: i32): i32 {
  const newPosition = getPixelByMode(pos, w, h, mode);
  if(newPosition < 0) {
    return 0
  }
  return load<u8>(newPosition);
}

/**
 * Performs a 3x3 convolution operation on an array.
 *
 * This function applies a 3x3 convolution kernel to an array, for the purpose
 * of image processing, such as blurring, sharpening, edge detection, etc. The specific
 * effect depends on the values of the kernel.
 *
 * @param byteSize - The size of the array in bytes
 * @param w - The width of the array
 * @param h - The height of the array
 * @param offset - An offset value to add to the result of the convolution operation
 * @param mode - The mode for handling out-of-bounds values in the convolution operation
 * @param v00-v22 - The values of the 3x3 convolution kernel
 * @returns 0
 */
export function convolve(
  byteSize: i32,
  w: i32,
  h: i32,
  offset: i32,
  mode: i32,
  v00: i32,
  v01: i32,
  v02: i32,
  v10: i32,
  v11: i32,
  v12: i32,
  v20: i32,
  v21: i32,
  v22: i32,
): i32 {
  // Calculate the sum of the kernel values to use as a divisor
  let divisor = v00 + v01 + v02 + v10 + v11 + v12 + v20 + v21 + v22 || 1;

  // Loop through each element in the array
  for (let i = 0; i < byteSize; i++) {
    // Every fourth element is stored as-is, meaning Alpha channel
    if (((i + 1) & 3) == 0) {
      store<u8>(i + byteSize, load<u8>(i));
      continue;
    }
    // Calculate the stride, or the distance between elements in the same column
    let stride = w * 4;

    // Calculate the indices of the previous and next elements in the same column
    let upColumn = i + stride;
    let downColumn = i - stride;

    // Perform the convolution operation using the 3x3 kernel and the addConvolveValue helper function
    let res =
      v00 * addConvolveValue(upColumn - 4, byteSize, w, h, mode) +
      v01 * addConvolveValue(upColumn, byteSize, w, h, mode) +
      v02 * addConvolveValue(upColumn + 4, byteSize, w, h, mode) +
      v10 * addConvolveValue(i - 4, byteSize, w, h, mode) +
      v11 * addConvolveValue(i, byteSize, w, h, mode) +
      v12 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      v20 * addConvolveValue(downColumn - 4, byteSize, w, h, mode) +
      v21 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      v22 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    // Divide the result by the divisor and add the offset value
    res /= divisor;
    res += offset;

    // Store the result in the output array
    store<u8>(i + byteSize, u8(res));
  }
  return 0;
}

/**
 * Performs a 3x3 Gaussian blur convolution operation on an image.
 *
 * This function applies a 3x3 Gaussian blur convolution kernel to an image.
 *
 * @param byteSize - The size of the image in bytes
 * @param w - The width of the image
 * @param h - The height of the image
 * @param offset - An offset value to add to the result of the convolution operation
 * @param mode - The mode for handling out-of-bounds values in the convolution operation
 * @param sigma - The standard deviation of the Gaussian blur
 * @returns 0
 */
export function convolveGaussian(
  byteSize: i32,
  w: i32,
  h: i32,
  offset: i32,
  mode: i32,
  sigma: f64,
): i32 {
  const v00 = getGauss(-1, 1, sigma);
  const v01 = getGauss(0, 1, sigma);
  const v02 = getGauss(1, 1, sigma);
  const v10 = getGauss(-1, 0, sigma);
  const v11 = getGauss(0, 0, sigma);
  const v12 = getGauss(1, 0, sigma);
  const v20 = getGauss(-1, -1, sigma);
  const v21 = getGauss(0, -1, sigma);
  const v22 = getGauss(1, -1, sigma);
  
  
  // Calculate the sum of the kernel values to use as a divisor
  let divisor = v00 + v01 + v02 + v10 + v11 + v12 + v20 + v21 + v22 || 1;

  // Loop through each element in the image
  for (let i = 0; i < byteSize; i++) {
    // Every fourth element is stored as-is, meaning Alpha channel
    if (((i + 1) & 3) == 0) {
      store<u8>(i + byteSize, load<u8>(i));
      continue;
    }
    // Calculate the stride, or the distance between elements in the same column
    let stride = w * 4;

    // Calculate the indices of the previous and next elements in the same column
    let upColumn = i + stride;
    let downColumn = i - stride;

    // Perform the convolution operation using the 3x3 kernel and the addConvolveValue helper function
    let res =
      v00 * addConvolveValue(upColumn - 4, byteSize, w, h, mode) +
      v01 * addConvolveValue(upColumn, byteSize, w, h, mode) +
      v02 * addConvolveValue(upColumn + 4, byteSize, w, h, mode) +
      v10 * addConvolveValue(i - 4, byteSize, w, h, mode) +
      v11 * addConvolveValue(i, byteSize, w, h, mode) +
      v12 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      v20 * addConvolveValue(downColumn - 4, byteSize, w, h, mode) +
      v21 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      v22 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    // Divide the result by the divisor and add the offset value
    res /= divisor;
    res += offset;

    // Store the result in the output array
    store<u8>(i + byteSize, u8(res));
  }
  return 0;
}



export function edgeDetection(
  byteSize: i32,
  w: i32,
  h: i32,
  offset: i32,
  mode: i32,
  vx00: i32,
  vx01: i32,
  vx02: i32,
  vx10: i32,
  vx11: i32,
  vx12: i32,
  vx20: i32,
  vx21: i32,
  vx22: i32,
  vy00: i32,
  vy01: i32,
  vy02: i32,
  vy10: i32,
  vy11: i32,
  vy12: i32,
  vy20: i32,
  vy21: i32,
  vy22: i32,
): i32 {
  // Calculate the sum of the kernel values to use as a divisor
  let divisorX = vx00 + vx01 + vx02 + vx10 + vx11 + vx12 + vx20 + vx21 + vx22 || 1;
  let divisorY = vy00 + vy01 + vy02 + vy10 + vy11 + vy12 + vy20 + vy21 + vy22 || 1;

  // Loop through each element in the array
  for (let i = 0; i < byteSize; i++) {
    // Every fourth element is stored as-is, meaning Alpha channel
    if (((i + 1) & 3) == 0) {
      store<u8>(i + byteSize, load<u8>(i));
      continue;
    }
    // Calculate the stride, or the distance between elements in the same column
    let stride = w * 4;

    // Calculate the indices of the previous and next elements in the same column
    let upColumn = i - stride;
    let downColumn = i + stride;

    //  Perform the convolution operation using the 3x3 kernel and the addConvolveValue helper function
    let resX =
      vx00 * addConvolveValue(upColumn - 4, byteSize, w, h, mode) +
      vx01 * addConvolveValue(upColumn, byteSize, w, h, mode) +
      vx02 * addConvolveValue(upColumn + 4, byteSize, w, h, mode) +
      vx10 * addConvolveValue(i - 4, byteSize, w, h, mode) +
      vx11 * addConvolveValue(i, byteSize, w, h, mode) +
      vx12 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      vx20 * addConvolveValue(downColumn - 4, byteSize, w, h, mode) +
      vx21 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      vx22 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    let resY =
      vy00 * addConvolveValue(upColumn - 4, byteSize, w, h, mode) +
      vy01 * addConvolveValue(upColumn, byteSize, w, h, mode) +
      vy02 * addConvolveValue(upColumn + 4, byteSize, w, h, mode) +
      vy10 * addConvolveValue(i - 4, byteSize, w, h, mode) +
      vy11 * addConvolveValue(i, byteSize, w, h, mode) +
      vy12 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      vy20 * addConvolveValue(downColumn - 4, byteSize, w, h, mode) +
      vy21 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      vy22 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    // Divide the result by the divisor and add the offset value
    resX /= divisorX;
    resY /= divisorY;

    const result = sqrt<f64>(resX * resX + resY * resY);

    // Store the result in the output array
    store<u8>(i + byteSize, u8(result));
  }
  return 0;
}

export function edgeDetectionMatrix2(
  byteSize: i32,
  w: i32,
  h: i32,
  offset: i32,
  mode: i32,
  vx00: i32,
  vx01: i32,
  vx10: i32,
  vx11: i32,
  vy00: i32,
  vy01: i32,
  vy10: i32,
  vy11: i32,
): i32 {
  // Calculate the sum of the kernel values to use as a divisor
  let divisorX = vx00 + vx01 + vx10 + vx11 || 1;
  let divisorY = vy00 + vy01 + vy10 + vy11 || 1;

  // Loop through each element in the array
  for (let i = 0; i < byteSize; i++) {
    // Every fourth element is stored as-is, meaning Alpha channel
    if (((i + 1) & 3) == 0) {
      store<u8>(i + byteSize, load<u8>(i));
      continue;
    }
    // Calculate the stride, or the distance between elements in the same column
    let stride = w * 4;

    // Calculate the indices of the previous and next elements in the same column
    let upColumn = i - stride;
    let downColumn = i + stride;

    //  Perform the convolution operation using the 2x2 kernel and the addConvolveValue helper function
    let resX =
      vx00 * addConvolveValue(i, byteSize, w, h, mode) +
      vx01 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      vx10 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      vx11 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    let resY =
      vy00 * addConvolveValue(i, byteSize, w, h, mode) +
      vy01 * addConvolveValue(i + 4, byteSize, w, h, mode) +
      vy10 * addConvolveValue(downColumn, byteSize, w, h, mode) +
      vy11 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);

    // Divide the result by the divisor and add the offset value
    resX /= divisorX;
    resY /= divisorY;

    const result = sqrt<f64>(resX * resX + resY * resY) * 4;

    // Store the result in the output array
    store<u8>(i + byteSize, u8(result));
  }
  return 0;
}

export function edgeDetectionZero(
  byteSize: i32,
  w: i32,
  h: i32,
  offset: i32,
  mode: i32,
  sigma: f64,
  t: i32
): i32 {
  const center = 128;

  const v00 = getLaplacianOfGauss(-1, 1, sigma);
  const v01 = getLaplacianOfGauss(0, 1, sigma);
  const v02 = getLaplacianOfGauss(1, 1, sigma);
  const v10 = getLaplacianOfGauss(-1, 0, sigma);
  const v11 = getLaplacianOfGauss(0, 0, sigma);
  const v12 = getLaplacianOfGauss(1, 0, sigma);
  const v20 = getLaplacianOfGauss(-1, -1, sigma);
  const v21 = getLaplacianOfGauss(0, -1, sigma);
  const v22 = getLaplacianOfGauss(1, -1, sigma);
  // Calculate the sum of the kernel values to use as a divisor
  let divisor = v00 + v01 + v02 + v10 + v11 + v12 + v20 + v21 + v22 || 1;

  // Loop through each element in the array
  for (let i = 0; i < byteSize; i++) {
    // Every fourth element is stored as-is, meaning Alpha channel
    if (((i + 1) & 3) == 0) {
      store<u8>(i + byteSize, load<u8>(i));
      continue;
    }
    // Calculate the stride, or the distance between elements in the same column
    let stride = w * 4;

    // Calculate the indices of the previous and next elements in the same column
    let upColumn = i - stride;
    let downColumn = i + stride;
    let max:f64 = 0;
    let min:f64 = 1000;

    // Compute each expression and update min and max values
    let res1 = v00 * addConvolveValue(upColumn - 4, byteSize, w, h, mode);
    min = Math.min(min, res1);
    max = Math.max(max, res1);

    let res2 = v01 * addConvolveValue(upColumn, byteSize, w, h, mode);
    min = Math.min(min, res2);
    max = Math.max(max, res2);

    let res3 = v02 * addConvolveValue(upColumn + 4, byteSize, w, h, mode);
    min = Math.min(min, res3);
    max = Math.max(max, res3);

    let res4 = v10 * addConvolveValue(i - 4, byteSize, w, h, mode);
    min = Math.min(min, res4);
    max = Math.max(max, res4);

    let res5 = v11 * addConvolveValue(i, byteSize, w, h, mode);
    min = Math.min(min, res5);
    max = Math.max(max, res5);

    let res6 = v12 * addConvolveValue(i + 4, byteSize, w, h, mode);
    min = Math.min(min, res6);
    max = Math.max(max, res6);

    let res7 = v20 * addConvolveValue(downColumn - 4, byteSize, w, h, mode);
    min = Math.min(min, res7);
    max = Math.max(max, res7);

    let res8 = v21 * addConvolveValue(downColumn, byteSize, w, h, mode);
    min = Math.min(min, res8);
    max = Math.max(max, res8);

    let res9 = v22 * addConvolveValue(downColumn + 4, byteSize, w, h, mode);
    min = Math.min(min, res9);
    max = Math.max(max, res9);

    // Calculate res by summing all results
    let res = res1 + res2 + res3 + res4 + res5 + res6 + res7 + res8 + res9;


    // Divide the result by the divisor and add the offset value
    res /= divisor;
    res += offset;
    const result = min < (center - t) && max > (center + t) ? res : 0;

    // Store the result in the output array
    store<u8>(i + byteSize, u8(result));
  }
  return 0;
}
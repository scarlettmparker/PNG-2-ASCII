import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import { promisify } from 'util';
import fs from 'fs';
import zlib from 'zlib';

// parse the header of the png, ensure it's a valid png
function parseHeader(buffer: Buffer) {
    if (buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Invalid PNG signature');
    }
}

// convert the buffer to chunks
function chunker(buffer: Buffer) {
    const chunks = [];
    // start at 8 to skip the header
    for (let i = 8; i < buffer.length;) {
        // read the length of the chunk
        const length = buffer.readUInt32BE(i);
        const type = buffer.slice(i + 4, i + 8).toString('ascii');
        chunks.push({ length, type, data: buffer.slice(i + 8, i + 8 + length), crc: buffer.readUInt32BE(i + 8 + length) });
        i += 12 + length;
    }
    return chunks;
}

/* parse the IHDR chunk
parse the idhr chunk to get the width, height, bit depth, and color type of the image
idhr chunk always appears first and is 13 bytes, this information can be found at:
http://www.libpng.org/pub/png/spec/1.2/PNG-Chunks.html
it contains the width, height, bit depth, colour type, compression type, filter method and interlace method
for this ascii art generator we only need the width, height, bit depth and colour type*/
function parseIHDR(chunks: any[]) {
    // check if the ihdr chunk exists if not just throw an error
    const ihdr = chunks.find(({ type }) => type === 'IHDR');
    if (!ihdr) throw new Error('IHDR chunk not found');

    // read the components from the idhr chunk as previously described
    const width = ihdr.data.readUInt32BE(0);
    const height = ihdr.data.readUInt32BE(4);
    const bitDepth = ihdr.data.readUInt8(8);
    const colorType = ihdr.data.readUInt8(9);

    // not supporting interlaced images because image data is different or something and i don't want to deal with additional logic for that
    if (ihdr.data.readUInt8(12) !== 0) throw new Error('Interlaced images not supported :(');
    return { width, height, bitDepth, colorType };
}

/* parse the IDAT chunk
parse the idat chunk to get the image data
this chunk contains the actual image data as described on the website */
async function parseIDAT(chunks: any[], width: number, height: number, colorType: number) {
    // get all the idat chunks and concatenate them
    const idatData = Buffer.concat(chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data));
    const decompressedData = await promisify(zlib.inflate)(idatData);
    const data = [];

    let i = 0;
    for (let y = 0; y < height; y++) {
        // filter type is the first byte of each scanline
        const filterType = decompressedData.readUInt8(i++);
        for (let x = 0; x < width; x++) {
            // read the pixel data based on the color type
            let [r, g, b, a] = [0, 0, 0, 255];
            if (colorType === 2) [r, g, b] = [decompressedData.readUInt8(i++), decompressedData.readUInt8(i++), decompressedData.readUInt8(i++)];
            else if (colorType === 6) [r, g, b, a] = [decompressedData.readUInt8(i++),
                decompressedData.readUInt8(i++), decompressedData.readUInt8(i++), decompressedData.readUInt8(i++)];

            // determine neighboring pixel values for filtering
            const prev = x ? data[data.length - 1] : { r: 0, g: 0, b: 0, a: 0 };
            const above = y ? data[(y - 1) * width + x] : { r: 0, g: 0, b: 0, a: 0 };
            const aboveLeft = (x && y) ? data[(y - 1) * width + (x - 1)] : { r: 0, g: 0, b: 0, a: 0 };

            switch (filterType) {
                // sub
                case 1: [r, g, b, a] = [r + prev.r, g + prev.g, b + prev.b, a + prev.a]; break;
                // up
                case 2: [r, g, b, a] = [r + above.r, g + above.g, b + above.b, a + above.a]; break;
                // average
                case 3: [r, g, b, a] = [r + Math.floor((prev.r + above.r) / 2), g + Math.floor((prev.g + above.g) / 2),
                b + Math.floor((prev.b + above.b) / 2), a + Math.floor((prev.a + above.a) / 2)]; break;
                // paeth
                case 4: [r, g, b, a] = [r + paethPredictor(prev.r, above.r, aboveLeft.r), g + paethPredictor(prev.g, above.g, aboveLeft.g),
                b + paethPredictor(prev.b, above.b, aboveLeft.b), a + paethPredictor(prev.a, above.a, aboveLeft.a)]; break;
            }
            // add the computed pixel values to the data array, make sure they are within byte range
            data.push({ r: r & 0xFF, g: g & 0xFF, b: b & 0xFF, a: a & 0xFF });
        }
    }
    return data;
}

// paeth predictor for filtering
function paethPredictor(a: number, b: number, c: number) {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// resize the image to desired width and height
function resizeImage(data: any[], width: number, height: number, widthN: number, heightN: number) {
    const resized = [];
    const xRatio = width / widthN;
    const yRatio = height / heightN;

    // iterate over the new dimensions and get the pixel from the original image
    for (let y = 0; y < heightN; y++) {
        for (let x = 0; x < widthN; x++) {
            // use bilinear interpolation to get the pixel value
            const srcX = Math.floor(x * xRatio);
            const srcY = Math.floor(y * yRatio);
            const xWeight = (x * xRatio) - srcX;
            const yWeight = (y * yRatio) - srcY;

            // get the neighboring pixels for interpolation
            const topLeft = data[srcY * width + srcX] || { r: 0, g: 0, b: 0, a: 0 };
            const topRight = data[srcY * width + (srcX + 1)] || { r: 0, g: 0, b: 0, a: 0 };
            const bottomLeft = data[(srcY + 1) * width + srcX] || { r: 0, g: 0, b: 0, a: 0 };
            const bottomRight = data[(srcY + 1) * width + (srcX + 1)] || { r: 0, g: 0, b: 0, a: 0 };

            // interpolate the pixel values and add them to the resized data
            const { r, g, b, a } = bilinearInterpolate(topLeft, topRight, bottomLeft, bottomRight, xWeight, yWeight);
            resized.push({ r: r & 0xFF, g: g & 0xFF, b: b & 0xFF, a: a & 0xFF });
        }
    }
    return resized;
}

// bilinear interpolation to calculate the pixel color based on neighboring pixels so weird lines don't show up
function bilinearInterpolate(topLeft: { r: number, g: number, b: number, a: number }, topRight: { r: number, g: number, b: number, a: number },
    bottomLeft: { r: number, g: number, b: number, a: number }, bottomRight: { r: number, g: number, b: number, a: number }, xWeight: number, yWeight: number) {
    // calculate the inverse weights
    const xInverseWeight = 1 - xWeight;
    const yInverseWeight = 1 - yWeight;

    // calculate combined weights for each corner
    const topLeftWeight = xInverseWeight * yInverseWeight;
    const topRightWeight = xWeight * yInverseWeight;
    const bottomLeftWeight = xInverseWeight * yWeight;
    const bottomRightWeight = xWeight * yWeight;

    // red component
    const r = Math.round(
        topLeft.r * topLeftWeight +
        topRight.r * topRightWeight +
        bottomLeft.r * bottomLeftWeight +
        bottomRight.r * bottomRightWeight
    );

    // green component
    const g = Math.round(
        topLeft.g * topLeftWeight +
        topRight.g * topRightWeight +
        bottomLeft.g * bottomLeftWeight +
        bottomRight.g * bottomRightWeight
    );

    // blue component
    const b = Math.round(
        topLeft.b * topLeftWeight +
        topRight.b * topRightWeight +
        bottomLeft.b * bottomLeftWeight +
        bottomRight.b * bottomRightWeight
    );

    // alpha component
    const a = Math.round(
        topLeft.a * topLeftWeight +
        topRight.a * topRightWeight +
        bottomLeft.a * bottomLeftWeight +
        bottomRight.a * bottomRightWeight
    );

    // return the interpolated color and alpha values
    return { r, g, b, a };
}

// convert the pixel data to ascii, and wrap it in html based on the color of the pixel
function toAsciiHtml(data: any[], width: number) {
    // characters to use based on luminance
    const chars = ['.', '+', '*', '#', '@'];
    let ascii = '';
    for (let i = 0; i < data.length; i++) {
        const p = data[i];
         // if the pixel is transparent, just add a space
        if (p.a === 0) {
            ascii += ' ';
        } else {
            // calculate the luminance of the pixel and get the corresponding character
            const luminance = ((0.299 * p.r + 0.587 * p.g + 0.114 * p.b) / 255) * (chars.length - 1);
            const char = chars[Math.floor(luminance)];
            const color = `rgb(${p.r},${p.g},${p.b})`;

            // return the character wrapped in a span with the color
            ascii += `<span style="color: ${color};">${char}</span>`;
        }
        if ((i + 1) % width === 0) ascii += '\n';
    }
    return `<pre>${ascii}</pre>`;
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
    // parse the incoming form data
    const form = new IncomingForm();
    form.parse(req, async (err, fields, files) => {
        // if there's for some reason an error parsing the file, return an error
        if (err) return res.status(500).json({ error: 'Error parsing the file!' });

        // if there's no file uploaded, return an error
        if (!files.file || !files.file[0] || !files.file[0].filepath) {
            return res.status(400).json({ error: 'No file uploaded!' });
        }

        const widthN = parseInt(fields.width as unknown as string, 10) || 150;

        try {
            // read the image buffer and parse the png
            const imageBuffer = await fs.promises.readFile(files.file[0].filepath);
            parseHeader(imageBuffer);

            // get the chunks, parse the ihdr chunk and the idat chunk
            const chunks = chunker(imageBuffer);
            const { width, height, colorType } = parseIHDR(chunks);
            const data = await parseIDAT(chunks, width, height, colorType);

            // resize the image and convert it to ascii
            const heightN = Math.floor((height / width) * widthN);
            const resizedData = resizeImage(data, width, height, widthN, heightN);
            const asciiArt = toAsciiHtml(resizedData, widthN);

            // return the new ascii art
            return res.status(200).json({ ascii: asciiArt });
        } catch (error) {
            return res.status(500).json({ error: error as Error });
        }
    });
};

// disable body parsing for formidable to work
export const config = { api: { bodyParser: false } };

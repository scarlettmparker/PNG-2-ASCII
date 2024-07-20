import React, { useState, useRef } from 'react';
import styles from './styles/index.module.css';

// RAHHHH
const msg = "RAHHH";

// UPLOAD PNG
async function uploadPNG(formData: FormData): Promise<{ ascii?: string }> {
    try {
        // send the form data to the server
        const res = await fetch("/api/asciipng", {
            method: 'POST',
            body: formData
        });

        // if something goes wrong DON'T EVEN HIT THEM WITH THE RAHH CAUSE I'M EVIL
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
    } catch (err) {
        console.error('Upload error:', err);
        throw err;
    }
}

// HANDLE FORM SUBMISSION
async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
    file: File | null,
    width: number,
    setAsciiArt: React.Dispatch<React.SetStateAction<string | null>>,
    setFileInputText: React.Dispatch<React.SetStateAction<string>>,
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
) {
    // prevent default form submission
    e.preventDefault();

    if (!file) {
        setFileInputText(`Please upload a file! ${msg}`);
        return;
    }

    // create formdata object and append the file and the width
    const formData = new FormData();
    formData.append("file", file);
    formData.append("width", width.toString());

    setIsLoading(true); // Start loading

    try {
        const { ascii } = await uploadPNG(formData);
        setAsciiArt(ascii || "Error processing PNG!");
    } catch {
        setFileInputText("Error uploading the PNG file!");
    } finally {
        setIsLoading(false); // Stop loading
    }
}

// HANDLE FILE CHANGE
function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: React.Dispatch<React.SetStateAction<File | null>>,
    setFileInputText: React.Dispatch<React.SetStateAction<string>>
) {
    // get the file from the input
    const selectedFile = e.target.files?.[0];
    if (selectedFile?.type === "image/png") {
        setFile(selectedFile);
        setFileInputText(selectedFile.name);
    } else {
        setFile(null);
        setFileInputText("Error: Please select a PNG file!");
    }
}

// HANDLE WIDTH CHANGE
function handleWidthChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setWidth: React.Dispatch<React.SetStateAction<number>>
) {
    const value = Number(e.target.value);
    const widthM = 350;
    // ensure width is within bounds
    if (value > 0 && value <= widthM) {
        setWidth(value);
    } else if (value > widthM) {
        setWidth(widthM);
    }
}

// DEFAULT HOME
const Home: React.FC = () => {
    // i love hooks
    const [file, setFile] = useState<File | null>(null);
    const [asciiArt, setAsciiArt] = useState<string | null>(null);
    const [width, setWidth] = useState<number>(150);

    // file input text and loading state
    const [fileInputText, setFileInputText] = useState<string>("Choose a file");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <div className={styles.pageWrapper}>
                <span className={styles.title}>PNG to ASCII</span>
                <div className={styles.uploadWrapper}>
                    <form onSubmit={(e) => handleSubmit(e, file, width, setAsciiArt, setFileInputText, setIsLoading)} className={styles.formWrapper}>
                        <CustomFileInput
                            handleFileChange={handleFileChange}
                            setFile={setFile}
                            fileInputRef={fileInputRef}
                            fileInputText={fileInputText}
                            setFileInputText={setFileInputText}
                        />
                        <div className={styles.widthWrapper}>
                            <span className={styles.widthText}>Width: </span>
                            <input
                                type="number"
                                value={width}
                                onChange={(e) => handleWidthChange(e, setWidth)}
                                min="1"
                                max="500"
                            />
                        </div>
                        <button
                            type="submit"
                            className={styles.button}
                            disabled={isLoading} // disable button while loading
                        >
                            {isLoading ? "Processing..." : "ASCII THIS PNG YEAH"}
                        </button>
                    </form>
                </div>
                {asciiArt && (
                    <div
                        className={styles.asciiWrapper}
                        dangerouslySetInnerHTML={{ __html: asciiArt }}
                    />
                )}
            </div>
            <div className={styles.backgroundWrapper}></div>
        </>
    );
}

// CUSTOM FILE INPUT TYPING
type CustomFileInputProps = {
    handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, setFile: React.Dispatch<React.SetStateAction<File | null>>, setFileInputText: React.Dispatch<React.SetStateAction<string>>) => void;
    setFile: React.Dispatch<React.SetStateAction<File | null>>;
    fileInputRef: React.RefObject<HTMLInputElement>;
    fileInputText: string;
    setFileInputText: React.Dispatch<React.SetStateAction<string>>;
};

// CUSTOM FILE INPUT
const CustomFileInput: React.FC<CustomFileInputProps> = ({ handleFileChange, setFile, fileInputRef, fileInputText, setFileInputText }) => {
    return (
        <label className={styles.customFileInput}>
            <span>{fileInputText || "Choose a file"}</span>
            <input
                type="file"
                accept="image/png"
                onChange={(e) => handleFileChange(e, setFile, setFileInputText)}
                className={styles.fileInput}
                ref={fileInputRef}
            />
        </label>
    );
};

export default Home;

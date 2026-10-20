import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';


import dotenv from 'dotenv';
dotenv.config();

const s3 = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const s3Bucket = 'registeration-docs'; // Your S3 bucket name

const fileUpload = async (filePath) => {
  try {
    const fileStream = fs.createReadStream(filePath);
    const fileKey = `${Date.now()}-${filePath.split('/').pop()}`;
    const putCommand = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: fileKey,
      Body: fileStream,
    });

    await s3.send(putCommand);

    const fileUrl = `https://${s3Bucket}.s3.us-east-1.amazonaws.com/${fileKey}`;
    console.log(`File uploaded successfully: ${fileUrl}`);
    fs.unlinkSync(filePath);
    console.log(`File deleted successfully: ${filePath}`);

    return  fileUrl ;
  } catch (error) {
    fs.unlinkSync(filePath);
    throw error;
  }
};


const bufferUpload = async (buffer, filename, contentType = 'image/jpeg') => {
  const fileKey = `${Date.now()}-${filename}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: fileKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  const fileUrl = `https://${s3Bucket}.s3.us-east-1.amazonaws.com/${fileKey}`;
  console.log(`Buffer uploaded successfully: ${fileUrl}`);
  return fileUrl;
};


const deleteOldFile = async (fileKey) => {
  try {
    const delCommand = new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: fileKey,
    });
    const remove = await s3.send(delCommand);
    console.log('remove', remove);
  } catch (error) {
    console.error('Error deleting S3 file:', error);
  }
};

export { fileUpload, bufferUpload, deleteOldFile };

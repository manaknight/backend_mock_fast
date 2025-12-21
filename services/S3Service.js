const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");
const mime = require("mime-types");
const path = require("path");

/**
 * Production-ready S3 Service for file storage operations
 */
class S3Service {
  constructor() {
    this.validateEnvironment();

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.AWS_S3_BUCKET_NAME;
    this.maxFileSize =
      parseInt(process.env.MAX_FILE_SIZE_MB || "50") * 1024 * 1024;
    this.allowedMimeTypes = process.env.ALLOWED_MIME_TYPES
      ? process.env.ALLOWED_MIME_TYPES.split(",").map((type) => type.trim())
      : null;

    this.initializeBucket();
  }

  validateEnvironment() {
    const requiredVars = [
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_S3_BUCKET_NAME",
    ];
    const missingVars = requiredVars.filter((varName) => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(
        `Missing AWS environment variables: ${missingVars.join(", ")}`
      );
    }
  }

  async initializeBucket() {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName })
      );
      console.log(`S3 bucket ${this.bucketName} is accessible`);
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        try {
          await this.s3Client.send(
            new CreateBucketCommand({
              Bucket: this.bucketName,
              CreateBucketConfiguration:
                process.env.AWS_REGION !== "us-east-1"
                  ? { LocationConstraint: process.env.AWS_REGION }
                  : undefined,
            })
          );
          console.log(`S3 bucket ${this.bucketName} created successfully`);
        } catch (createError) {
          console.error("Failed to create S3 bucket:", createError);
          throw new Error("Failed to initialize S3 bucket");
        }
      } else {
        console.error("S3 bucket access error:", error);
        throw new Error("Failed to access S3 bucket");
      }
    }
  }

  /**
   * Generate a safe file key for S3 storage
   * @param {string} namespace - The namespace for the file
   * @param {string} originalName - Original filename
   * @param {boolean} isPublic - Whether the file should be publicly accessible
   * @returns {string} - Generated S3 key
   */
  generateFileKey(namespace, originalName, isPublic = false) {
    if (!namespace || typeof namespace !== "string") {
      throw new Error("Invalid namespace provided");
    }

    // Sanitize filename
    const sanitizedName = this.sanitizeFilename(originalName);
    const fileExtension = path.extname(sanitizedName);
    const baseName = path.basename(sanitizedName, fileExtension);

    // Generate unique identifier
    const uniqueId = uuidv4();
    const timestamp = Date.now();

    // Create namespace directory structure based on visibility
    const visibility = isPublic ? "public" : "private";
    const fileName = `${baseName}_${timestamp}_${uniqueId}${fileExtension}`;

    return `${namespace}/${visibility}/${fileName}`;
  }

  sanitizeFilename(filename) {
    if (!filename || typeof filename !== "string") {
      throw new Error("Invalid filename provided");
    }

    return filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .slice(0, 100);
  }

  validateFile(file) {
    if (!file || !file.buffer || !file.originalname) {
      throw new Error("Invalid file object provided");
    }

    const errors = [];

    if (file.size > this.maxFileSize) {
      errors.push(
        `File size ${(file.size / 1024 / 1024).toFixed(
          2
        )}MB exceeds maximum allowed size of ${
          this.maxFileSize / 1024 / 1024
        }MB`
      );
    }

    const detectedMimeType = mime.lookup(file.originalname) || file.mimetype;
    if (
      this.allowedMimeTypes &&
      !this.allowedMimeTypes.includes(detectedMimeType)
    ) {
      errors.push(
        `File type ${detectedMimeType} is not allowed. Allowed types: ${this.allowedMimeTypes.join(
          ", "
        )}`
      );
    }

    if (!file.originalname || file.originalname.trim().length === 0) {
      errors.push("Filename cannot be empty");
    }

    if (file.originalname.length > 255) {
      errors.push("Filename too long (maximum 255 characters)");
    }

    return {
      isValid: errors.length === 0,
      errors,
      detectedMimeType,
    };
  }

  async uploadFile(file, namespace, userId, isPublic = false) {
    try {
      // Input validation
      if (!file || !namespace || !userId) {
        throw new Error(
          "Missing required parameters: file, namespace, or userId"
        );
      }

      const validation = this.validateFile(file);
      if (!validation.isValid) {
        throw new Error(
          `File validation failed: ${validation.errors.join(", ")}`
        );
      }

      const fileKey = this.generateFileKey(
        namespace,
        file.originalname,
        isPublic
      );

      // Set up upload parameters without ACL
      const uploadParams = {
        Bucket: this.bucketName,
        Key: fileKey,
        Body: file.buffer,
        ContentType: validation.detectedMimeType,
        Metadata: {
          originalName: file.originalname,
          namespace: namespace,
          userId: userId.toString(),
          uploadedAt: new Date().toISOString(),
          isPublic: isPublic.toString(),
        },
        CacheControl: isPublic
          ? "public, max-age=31536000"
          : "private, no-cache",
        ContentDisposition: isPublic ? "inline" : "attachment",
      };

      try {
        const command = new PutObjectCommand(uploadParams);
        const result = await this.s3Client.send(command);

        // Generate public URL based on the bucket policy for public files
        const publicUrl = isPublic
          ? `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`
          : null;

        return {
          success: true,
          fileKey,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: validation.detectedMimeType,
          isPublic,
          publicUrl,
          etag: result.ETag,
          uploadedAt: new Date().toISOString(),
          s3Response: result,
        };
      } catch (uploadError) {
        console.error("S3 upload error:", uploadError);
        throw new Error(`S3 upload failed: ${uploadError.message}`);
      }
    } catch (error) {
      console.error("File upload error:", error);
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async generateSignedUrl(fileKey, expiresIn = 3600) {
    try {
      if (!fileKey || typeof fileKey !== "string") {
        throw new Error("Invalid fileKey provided");
      }

      if (isNaN(expiresIn) || expiresIn <= 0) {
        throw new Error("Invalid expiresIn value");
      }

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: Math.min(expiresIn, 604800), // Cap at 7 days max
      });

      return signedUrl;
    } catch (error) {
      console.error("Error generating signed URL:", error);
      throw new Error(`Failed to generate file access URL: ${error.message}`);
    }
  }

  async fileExists(fileKey) {
    try {
      if (!fileKey || typeof fileKey !== "string") {
        throw new Error("Invalid fileKey provided");
      }

      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: fileKey,
        })
      );
      return true;
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async getFileMetadata(fileKey) {
    try {
      if (!fileKey || typeof fileKey !== "string") {
        throw new Error("Invalid fileKey provided");
      }

      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });

      const result = await this.s3Client.send(command);

      return {
        fileKey,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        etag: result.ETag,
        metadata: result.Metadata,
      };
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        throw new Error("File not found");
      }
      console.error("Error getting file metadata:", error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  async deleteFile(fileKey) {
    try {
      if (!fileKey || typeof fileKey !== "string") {
        throw new Error("Invalid fileKey provided");
      }

      const exists = await this.fileExists(fileKey);
      if (!exists) {
        throw new Error("File not found");
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });

      const result = await this.s3Client.send(command);

      return {
        success: true,
        fileKey,
        deletedAt: new Date().toISOString(),
        s3Response: result,
      };
    } catch (error) {
      console.error("S3 delete error:", error);
      throw new Error(`File deletion failed: ${error.message}`);
    }
  }

  getPublicUrl(fileKey) {
    if (!fileKey || typeof fileKey !== "string") {
      throw new Error("Invalid fileKey provided");
    }
    return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
  }
}

module.exports = S3Service;

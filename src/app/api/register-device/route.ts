import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
interface DeviceRegistrationData {
  name: string;
  company: string;
  description: string;
  companyProductUrl: string;
  tags: string[];
  researchSummary: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Extract form fields
    const name = formData.get('name') as string;
    const company = formData.get('company') as string;
    const description = formData.get('description') as string;
    const companyProductUrl = formData.get('companyProductUrl') as string;
    const tags = JSON.parse(formData.get('tags') as string || '[]');
    const researchSummary = formData.get('researchSummary') as string || '';

    // Extract files
    const images = formData.getAll('images') as File[];
    const clinicalFiles = formData.getAll('clinicalFiles') as File[];
    const clinicalFileUrls = JSON.parse(formData.get('clinicalFileUrls') as string || '[]');

    // Validate required fields
    if (!name || !company || !description || !companyProductUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: name, company, description, and companyProductUrl are required' },
        { status: 400 },
      );
    }

    if (tags.length === 0) {
      return NextResponse.json(
        { error: 'At least one medical category tag is required' },
        { status: 400 },
      );
    }

    // Generate unique IDs
    const deviceId = `device_${uuidv4()}`;
    const smartLinkId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uuidv4().substring(0, 8)}`;

    // Process clinical PDF files
    const processedClinicalFiles = [];
    
    for (let i = 0; i < clinicalFiles.length; i++) {
      const file = clinicalFiles[i];
      const clinicalFileId = `cf_${uuidv4()}`;

      try {
        // Extract text from PDF
        const extractedText = await extractTextFromPDF(file);
        
        // Generate embedding for the extracted text
        const embedding = await generateEmbedding(extractedText);

        processedClinicalFiles.push({
          id: clinicalFileId,
          filename: file.name,
          fileType: 'pdf' as const,
          description: `Clinical file: ${file.name}`,
          deviceId,
          uploadedAt: new Date().toISOString(),
          extractedContent: extractedText,
          embedding,
        });
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        // Continue with other files even if one fails
      }
    }

    // Process clinical file URLs
    for (const urlData of clinicalFileUrls) {
      const clinicalFileId = `cf_${uuidv4()}`;
      
      try {
        // Fetch content from URL if needed
        const extractedText = urlData.description || '';
        const embedding = await generateEmbedding(extractedText);

        processedClinicalFiles.push({
          id: clinicalFileId,
          filename: urlData.description,
          fileUrl: urlData.url,
          fileType: 'url' as const,
          description: urlData.description,
          deviceId,
          uploadedAt: new Date().toISOString(),
          extractedContent: extractedText,
          embedding,
        });
      } catch (error) {
        console.error(`Error processing URL ${urlData.url}:`, error);
      }
    }

    // Create device object
    const device = {
      id: deviceId,
      name,
      company,
      description,
      companyProductUrl,
      imageUrls: [], // TODO: Handle image uploads if needed
      tags,
      clinicalFiles: processedClinicalFiles,
      smartLinkId,
      userId: 'rep1', // TODO: Get from authenticated user session
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store device in database
    await storeDeviceInDatabase(device);

    // Store embeddings in vector database
    for (const clinicalFile of processedClinicalFiles) {
      if (clinicalFile.embedding) {
        await storeEmbeddingInDatabase({
          id: clinicalFile.id,
          deviceId,
          content: clinicalFile.extractedContent,
          embedding: clinicalFile.embedding,
          metadata: {
            filename: clinicalFile.filename,
            fileType: clinicalFile.fileType,
            description: clinicalFile.description,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      device: {
        id: device.id,
        name: device.name,
        smartLinkId: device.smartLinkId,
        clinicalFilesProcessed: processedClinicalFiles.length,
      },
      message: 'Device registered successfully',
    });
  } catch (error) {
    console.error('Error registering device:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 },
    );
  }
}

/**
 * Extract text from PDF file
 * For now, this is a placeholder that simulates PDF text extraction
 * In production, you would use a library like pdf-parse or call an external service
 */
async function extractTextFromPDF(file: File): Promise<string> {
  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // TODO: Implement actual PDF parsing
  // For now, return a placeholder text
  // In production, use a library like pdf-parse:
  // const pdfParse = require('pdf-parse');
  // const data = await pdfParse(buffer);
  // return data.text;

  return `[Extracted text from ${file.name}]\n\nThis is placeholder text extracted from the PDF file. In production, this would contain the actual text content from the PDF using a PDF parsing library like pdf-parse.`;
}

/**
 * Generate embedding for text using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not found, returning empty embedding');
      return [];
    }

    // Call OpenAI embeddings API
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text.substring(0, 8000), // Limit text length to avoid token limits
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      return [];
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return [];
  }
}

/**
 * Store device data in database
 */
async function storeDeviceInDatabase(device: {
  id: string;
  name: string;
  company: string;
  description: string;
  companyProductUrl: string;
  imageUrls: string[];
  tags: string[];
  clinicalFiles: unknown[];
  smartLinkId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}): Promise<void> {
  try {
    // Call Mastra backend to store device
    const MASTRA_API_URL = process.env.NEXT_PUBLIC_MASTRA_API_URL || 'http://localhost:4111';
    
    const response = await fetch(`${MASTRA_API_URL}/api/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(device),
    });

    if (!response.ok) {
      console.warn('Failed to store device in Mastra backend, continuing anyway');
    }
  } catch (error) {
    console.error('Error storing device:', error);
    // Don't fail the request if database storage fails
    // In production, you would want to handle this more gracefully
  }
}

/**
 * Store embedding in vector database
 */
async function storeEmbeddingInDatabase(data: {
  id: string;
  deviceId: string;
  content: string;
  embedding: number[];
  metadata: {
    filename: string;
    fileType: string;
    description: string;
  };
}): Promise<void> {
  try {
    // Call Mastra backend to store embedding
    const MASTRA_API_URL = process.env.NEXT_PUBLIC_MASTRA_API_URL || 'http://localhost:4111';
    
    const response = await fetch(`${MASTRA_API_URL}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      console.warn('Failed to store embedding in Mastra backend, continuing anyway');
    }
  } catch (error) {
    console.error('Error storing embedding:', error);
    // Don't fail the request if embedding storage fails
  }
}

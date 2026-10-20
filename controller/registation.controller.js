import db from '../db/db.js'; // adjust your DB connection path
import upload from '../middleware/mullter.middleware.js';
import { fileUpload } from '../utils/awsS3.js';

export const InsertRegistration = async (req, res) => {
  console.log('body', req.body);
  console.log('files', req.files);
  
  try {
    const {
      first_name,
      last_name,
      phone,
      date_of_birth,
      email,
      address_line1,
      address_line2,
      city,
      state,
      zip_code,
      country,
      class: className,
      school_name,
      board,
      school_address_line1,
      school_city,
      school_state,
      school_zip_code,
      school_country,
      medium,
      subjects,
    } = req.body || {};

    // Validate required files
    if (!req.files?.passport_photo?.[0]) {
      return res.status(400).json({ error: 'passport_photo is required' });
    }

    if (!req.files?.uid_aadhaar?.[0] && !req.files?.school_id?.[0]) {
      return res.status(400).json({ 
        error: 'Either uid_aadhaar or school_id file is required' 
      });
    }

    // Upload files with proper error handling
    let passport_photo_url, uid_aadhaar_url, school_id_url;
    
    try {
    
      passport_photo_url = await fileUpload(req.files.passport_photo[0].path);
      
      if (req.files.uid_aadhaar?.[0]) {
        uid_aadhaar_url = await fileUpload(req.files.uid_aadhaar[0].path);
      }
      
      if (req.files.school_id?.[0]) {
        school_id_url = await fileUpload(req.files.school_id[0].path);
      }
    } catch (uploadError) {
      console.error('File upload error:', uploadError);
      return res.status(500).json({ 
        error: 'File upload failed', 
        details: uploadError.message 
      });
    }

    if (!passport_photo_url) {
      return res.status(500).json({ error: 'Passport photo upload failed' });
    }

    if (!uid_aadhaar_url && !school_id_url) {
      return res.status(500).json({ 
        error: 'Neither uid_aadhaar nor school_id was uploaded successfully' 
      });
    }

    const subjectsString = Array.isArray(subjects) ? subjects.join(',') : subjects;

    const query = `
      INSERT INTO olympiad_registrations (
        first_name, last_name, phone, date_of_birth, email,
        address_line1, address_line2, city, state, zip_code, country,
        class, school_name, board, school_address_line1, school_city,
        school_state, school_zip_code, school_country, medium,
        passport_photo_url, uid_aadhaar_url, school_id_url, subjects,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW())
      RETURNING id
    `;

    const values = [
      first_name,
      last_name,
      phone,
      date_of_birth,
      email,
      address_line1,
      address_line2,
      city,
      state,
      zip_code,
      country,
      className,
      school_name,
      board,
      school_address_line1,
      school_city,
      school_state,
      school_zip_code,
      school_country,
      medium,
      passport_photo_url,
      uid_aadhaar_url || null,
      school_id_url || null,
      subjectsString,
    ];

    const result = await db.query(query, values);

    const insertId = result.rows?.[0]?.id;

    return res.status(201).json({
      success: true,
      inserted_id: insertId,
      message: 'Registration completed successfully'
    });

  } catch (error) {
    console.error('❌ InsertRegistration error:', error);

    if (error.code === '23505') {
      return res.status(409).json({ 
        error: 'Registration already exists',
        details: 'Duplicate entry detected'
      });
    }
    
    if (error.field && error.message) {
      return res.status(500).json({ 
        error: 'File upload error', 
        field: error.field, 
        message: error.message 
      });
    }
    
    return res.status(500).json({ 
      error: 'Database error or unexpected failure',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
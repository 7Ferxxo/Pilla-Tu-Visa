ALTER TABLE usuarios ADD COLUMN email VARCHAR(120) NOT NULL UNIQUE AFTER username;
ALTER TABLE usuarios ADD COLUMN role ENUM('admin','editor','viewer') NOT NULL DEFAULT 'admin' AFTER email;
ALTER TABLE usuarios CHANGE COLUMN password password_hash VARCHAR(255) NOT NULL;

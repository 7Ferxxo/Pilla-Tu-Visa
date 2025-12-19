ALTER TABLE usuarios
  ADD COLUMN role ENUM('admin','editor','viewer') NOT NULL DEFAULT 'admin' AFTER email;

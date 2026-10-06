# KUSK Network Manager

เว็บแอพสำหรับบริหารจัดการข้อมูลอุปกรณ์เครือข่ายของโรงเรียนสาธิตแห่งมหาวิทยาลัยเกษตรศาสตร์ วิทยาเขตกำแพงแสน

## Production

- Firebase Hosting: https://kusk-network-manager.web.app

## โครงสร้างหลัก

- `public/` ไฟล์หน้าเว็บทั้งหมดที่อนุญาตให้ Firebase Hosting เผยแพร่
- `public/home.html` หน้าแรกของระบบ
- `public/login.html` หน้าเข้าสู่ระบบ
- `public/pages/` หน้าจัดการ Switch, Access Point, อุปกรณ์ และคู่มือ VPN
- `public/components/` ส่วนประกอบที่ใช้ซ้ำ เช่น sidebar และ modal
- `public/css/` ไฟล์รูปแบบหน้าจอ
- `public/js/` ไฟล์การทำงานฝั่งหน้าเว็บ
- `agent/` สคริปต์ช่วยตรวจสถานะอุปกรณ์เครือข่าย
- `firestore.rules` และ `storage.rules` กฎควบคุมสิทธิ์ข้อมูลและรูปภาพ
- `public/pages/users.html` หน้ากำหนดสิทธิ์ผู้ใช้งาน

## หมายเหตุด้านความปลอดภัย

- ห้ามเก็บ Service Account Key ไว้ในโปรเจกต์หรืออัปโหลดขึ้น GitHub
- ตั้งค่า `GOOGLE_APPLICATION_CREDENTIALS` ให้ชี้ไปยังไฟล์กุญแจที่เก็บไว้นอกโฟลเดอร์โปรเจกต์
- Firebase Hosting เผยแพร่เฉพาะโฟลเดอร์ `public/` เท่านั้น
- Firestore และ Storage ส่วนที่มีข้อมูลภายในอนุญาตเฉพาะผู้ใช้ที่เข้าสู่ระบบแล้ว
- ผู้เยี่ยมชมอ่านได้เฉพาะ `publicSwitches` ซึ่งมีเพียงยี่ห้อ รุ่น สถานะ และเวลาปรับปรุง
- ชื่ออุปกรณ์ สถานที่ รูปภาพ และข้อมูลเครือข่ายไม่อยู่ในชุดข้อมูลสาธารณะ
- ระบบไม่บันทึก Username หรือ Password ของอุปกรณ์ใน Firestore
- สิทธิ์ผู้ใช้มี 5 ระดับ: ผู้ดูแลหลัก ผู้ดูแล ผู้แก้ไข ผู้ดู และค่าเริ่มต้น
- ผู้ดูเห็นเฉพาะข้อมูลทั่วไป สถานะ สถานที่ และรูปภาพของอุปกรณ์
- IP, MAC, Serial Number และลิงก์ตั้งค่าเก็บแยกใน `switchPrivate` ซึ่งผู้ดูอ่านไม่ได้
- บัญชีค่าเริ่มต้นจะยังเข้าถึงข้อมูลอุปกรณ์ไม่ได้จนกว่าผู้ดูแลจะกำหนดสิทธิ์
- รูปอุปกรณ์โหลดผ่าน Firebase Storage ด้วยบัญชีที่เข้าสู่ระบบ ไม่ใช้ลิงก์ดาวน์โหลดถาวร

ตัวอย่างการตั้งค่าเอเจนต์บน PowerShell:

เอเจนต์ต้องใช้ Node.js 22 ขึ้นไป

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\Martkung\.config\kusk-network-manager\agent-credentials.json"
cd agent
npm start
```

## ขั้นตอนปรับระบบเดิมให้ปลอดภัย

1. ยกเลิก Service Account Key เดิมใน Google Cloud IAM และสร้างกุญแจใหม่
2. เก็บกุญแจใหม่ไว้นอกโฟลเดอร์โปรเจกต์ แล้วตั้งค่า `GOOGLE_APPLICATION_CREDENTIALS`
3. ลบ Username และ Password เดิมออกจากข้อมูลอุปกรณ์ด้วยคำสั่งด้านล่าง
4. Deploy กฎความปลอดภัยและ Hosting ชุดใหม่

```powershell
cd agent
npm run security:remove-credentials
npm run security:sync-users
npm run security:migrate-private-data
npm run security:sync-public-switches
npm run security:configure-storage-cors
npm run security:verify-roles
cd ..
firebase deploy --only firestore:rules,storage,hosting
```

การ Deploy กฎ Storage ครั้งแรกที่มีการอ่านสิทธิ์จาก Firestore ต้องทำในเทอร์มินัลแบบโต้ตอบ และยืนยันให้ Firebase CLI เพิ่มบทบาท `roles/firebaserules.firestoreServiceAgent` แก่ Firebase Storage service agent เมื่อระบบถาม

ต้องล้างข้อมูลรหัสผ่านเดิมก่อน Deploy หน้าเว็บชุดใหม่ เนื่องจาก Firestore ไม่สามารถซ่อนข้อมูลเป็นรายช่องได้ กฎใหม่จะป้องกันไม่ให้มีการเขียนช่อง `username` หรือ `password` กลับเข้าไปอีก

คำสั่ง `security:sync-users` จะนำบัญชีจาก Firebase Authentication มาสร้างหรืออัปเดตในคอลเลกชัน `users` โดยไม่เขียนทับสิทธิ์ที่กำหนดไว้แล้ว บัญชีผู้ดูแลหลักจะถูกยืนยันเป็น `owner` ทุกครั้ง

การเปิด `/login.html` โดยไม่มี `?signin=1` จะเข้าสู่หน้าผู้เยี่ยมชมโดยอัตโนมัติ ผู้ใช้ที่ต้องการเข้าสู่ระบบให้ใช้ `/login.html?signin=1` ระบบจะอ่านข้อมูลสาธารณะจากคอลเลกชันแยก `publicSwitches` เท่านั้น

## Deploy

```powershell
firebase deploy --only firestore:rules,storage,hosting
```

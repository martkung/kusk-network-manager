# KUSK Network Manager

เว็บแอพสำหรับบริหารจัดการข้อมูลอุปกรณ์เครือข่ายของโรงเรียนสาธิตแห่งมหาวิทยาลัยเกษตรศาสตร์ วิทยาเขตกำแพงแสน

## Production

- Firebase Hosting: https://kusk-network-manager.web.app

## โครงสร้างหลัก

- `home.html` หน้าแรกของระบบ
- `login.html` หน้าเข้าสู่ระบบ
- `pages/` หน้าจัดการ Switch, Access Point, อุปกรณ์ และคู่มือ VPN
- `components/` ส่วนประกอบที่ใช้ซ้ำ เช่น sidebar และ modal
- `css/` ไฟล์รูปแบบหน้าจอ
- `js/` ไฟล์การทำงานฝั่งหน้าเว็บ
- `agent/` สคริปต์ช่วยตรวจสถานะอุปกรณ์เครือข่าย

## หมายเหตุด้านความปลอดภัย

ไฟล์ `agent/firebase-admin.json` เป็นกุญแจสำหรับ Firebase Admin และถูกกันไว้ใน `.gitignore` แล้ว ห้ามนำขึ้น GitHub

## Deploy

```bash
firebase deploy
```
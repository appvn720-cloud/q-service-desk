# Q Service Desk Local Server

คู่มือนี้สำหรับรันเว็บสำรองบนคอมของตัวเอง หรือย้ายไปติดตั้งบนเครื่อง server อื่น

## สิ่งที่ต้องมี

- Windows 10/11 หรือ Windows Server
- Python 3.10 ขึ้นไป
- Internet สำหรับเชื่อม Supabase

## วิธีติดตั้งบนเครื่อง server

1. คัดลอกโฟลเดอร์โปรเจกต์ `Q_servicedesk` ไปไว้บนเครื่อง server
2. คัดลอกไฟล์ `.env.example` แล้วเปลี่ยนชื่อเป็น `.env`
3. เปิด `.env` แล้วใส่ค่า Supabase

```text
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY
PORT=8080
```

4. ดับเบิลคลิก `start-server.bat`
5. เปิดเว็บในเครื่อง server

```text
http://localhost:8080
```

6. ให้เครื่องอื่นในวง LAN เปิดจาก IP ของ server เช่น

```text
http://192.168.1.25:8080
```

ตอนรัน server จะพิมพ์ URL แบบ LAN ให้ดูในหน้าต่าง command prompt

## เปิด Firewall

ถ้าเครื่องอื่นเข้าไม่ได้ ให้เปิด Windows Firewall สำหรับ port `8080`

PowerShell แบบ Run as Administrator:

```powershell
New-NetFirewallRule -DisplayName "Q Service Desk 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

## ย้ายไปเครื่องอื่น

คัดลอกทั้งโฟลเดอร์นี้ไปเครื่องใหม่ แล้วตรวจว่าไฟล์เหล่านี้อยู่ครบ:

```text
public/
supabase/
local_server.py
start-server.bat
.env
```

จากนั้นดับเบิลคลิก `start-server.bat`

## หมายเหตุ

- คอม server ต้องเปิดอยู่ เว็บถึงจะเข้าได้
- ฐานข้อมูลและ login ยังใช้ Supabase เดิม
- หน้า Admin สร้าง User ใช้ได้ เพราะ local server มี endpoint แทน Netlify Function แล้ว
- ถ้าต้องการให้คนนอกออฟฟิศเข้า แนะนำใช้ Cloudflare Tunnel ชี้มาที่ `http://localhost:8080`

import PDFDocument from "pdfkit";
import fs from "fs";
import type PDFKit from "pdfkit";

export interface ScheduleEmployee {
  name: string;
  isBold?: boolean;
}

export interface ScheduleShift {
  employee_name: string;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
}

export interface ScheduleExportData {
  location_code: string;
  location_name: string;
  week_end_date: string;
  week_start_date: string;
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
}

export function formatShiftTime(start24: string, end24: string): string {
  return `${formatTimeClearview(start24)} - ${formatTimeClearview(end24)}`;
}

/** Title-case role for PDF/CSV (Cook, Cashier, Packliner). */
export function formatRoleLabel(role: string): string {
  const upper = role.trim().toUpperCase();
  if (upper === "COOK") return "Cook";
  if (upper === "CASHIER") return "Cashier";
  if (upper === "PACKLINER") return "Packliner";
  if (!role) return "";
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

/** Cell text: "10AM - 4PM Cook" */
export function formatShiftCellLabel(start24: string, end24: string, role: string): string {
  const roleLabel = formatRoleLabel(role);
  const times = formatShiftTime(start24, end24);
  return roleLabel ? `${times} ${roleLabel}` : times;
}

export function formatTimeClearview(time24: string): string {
  const [hourStr, minStr] = time24.split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr ?? "0", 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

  if (min === 0) {
    return `${h12}${ampm}`;
  }
  return `${h12}:${String(min).padStart(2, "0")}${ampm}`;
}

/** "Firstname Lastname" → "Firstname L." (Clearview style) */
export function formatEmployeeDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts.slice(0, -1).join(" ");
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return `${firstName} ${lastInitial}.`;
}

export async function exportScheduleToPDF(
  data: ScheduleExportData,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pageW = doc.page.width;

    doc.fontSize(16).fillColor("#aaaaaa").font("Helvetica").text("Clearview Schedule", 36, 28);

    const title = `Schedule for ${data.location_code} - ${data.location_name} for week ending ${data.week_end_date}`;
    doc.fontSize(14).fillColor("#000000").font("Helvetica").text(title, 36, 55, {
      align: "center",
      width: pageW - 72,
    });

    const tableTop = 85;
    const employeeColW = 155;
    const dayColW = (pageW - 72 - employeeColW) / 7;
    const rowH = 18;
    const headerH = 28;

    const weekStart = new Date(`${data.week_start_date}T12:00:00`);
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];

    drawCell(doc, 36, tableTop, employeeColW, headerH, "Employee", true);

    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + d);
      const x = 36 + employeeColW + d * dayColW;
      const dateLabel = `${monthNames[dayDate.getMonth()]} ${dayDate.getDate()}`;
      drawDayHeader(doc, x, tableTop, dayColW, headerH, dateLabel, dayNames[d]);
    }

    const shiftLookup: Record<string, Record<string, string>> = {};
    for (const shift of data.shifts) {
      const name = shift.employee_name;
      if (!shiftLookup[name]) shiftLookup[name] = {};
      const existing = shiftLookup[name][shift.date];
      const label = formatShiftCellLabel(shift.start_time, shift.end_time, shift.role);
      shiftLookup[name][shift.date] = existing ? `${existing}\n${label}` : label;
    }

    const lineHeight = 11;
    const rowLineCounts = data.employees.map((emp) => {
      let maxLines = 1;
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + d);
        const dateStr = dayDate.toISOString().slice(0, 10);
        const text = shiftLookup[emp.name]?.[dateStr] ?? "";
        const lines = text ? text.split("\n").length : 1;
        if (lines > maxLines) maxLines = lines;
      }
      return maxLines;
    });

    let y = tableTop + headerH;
    for (let i = 0; i < data.employees.length; i++) {
      const emp = data.employees[i];
      const rowLines = rowLineCounts[i];
      const cellH = Math.max(rowH, rowLines * lineHeight + 6);
      const rowY = y;

      doc.fontSize(8).font(emp.isBold ? "Helvetica-Bold" : "Helvetica").fillColor("#000000");
      drawCell(doc, 36, rowY, employeeColW, cellH, emp.name, false, true);

      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + d);
        const dateStr = dayDate.toISOString().slice(0, 10);
        const shiftText = shiftLookup[emp.name]?.[dateStr] ?? "";
        const x = 36 + employeeColW + d * dayColW;
        doc.font("Helvetica").fontSize(8);
        drawCell(doc, x, rowY, dayColW, cellH, shiftText, false, false, true);
      }

      y += cellH;
    }

    const tableH = y - tableTop;
    doc.rect(36, tableTop, pageW - 72, tableH).stroke("#000000");

    doc
      .fontSize(8)
      .fillColor("#000000")
      .font("Helvetica")
      .text("© 2000 - 2026, Quick Service Software Inc.", 36, tableTop + tableH + 16);

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  bold: boolean,
  leftAlign = false,
  allowWrap = false
): void {
  doc.rect(x, y, w, h).stroke("#cccccc");
  if (!text) return;

  const textX = leftAlign ? x + 4 : x;
  const textW = leftAlign ? w - 6 : w;
  const fontSize = 8;
  const lineCount = allowWrap ? Math.max(1, text.split("\n").length) : 1;
  const blockH = lineCount * (fontSize + 1);
  const textY = y + Math.max(2, (h - blockH) / 2);

  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(fontSize)
    .fillColor("#000000")
    .text(text, textX, textY, {
      width: textW,
      align: leftAlign ? "left" : "center",
      lineBreak: allowWrap,
      lineGap: 1,
    });
}

function drawDayHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  dateLabel: string,
  dayLabel: string
): void {
  doc.rect(x, y, w, h).stroke("#cccccc");
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000000")
    .text(dateLabel, x, y + 4, { width: w, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(7).text(dayLabel, x, y + 14, {
    width: w,
    align: "center",
    lineBreak: false,
  });
}

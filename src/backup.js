const backupColumns = { members: ['id', 'name', 'phone', 'emergency', 'notes', 'photo', 'created', 'expires'], payments: ['id', 'member', 'name', 'kind', 'amount', 'method', 'created', 'by', 'period_end'], attendance: ['id', 'member', 'name', 'type', 'entered', 'exited', 'by'], settings: ['id', 'registration', 'monthly', 'walkin'], staff: ['email', 'role', 'name'], audit: ['id', 'created', 'by', 'action'] };
export function validateBackup(file) {
    if (!file || file.format !== 'raji-fitness-backup' || file.version !== 1 || !file.data || !Number.isFinite(Date.parse(file.createdAt)))
        throw Error('Choose a valid RAJI backup file (version 1).');
    if (JSON.stringify(file).length > 20 * 1024 * 1024)
        throw Error('Backup exceeds the 20 MB restore limit.');
    const output = {};
    const validDate = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
    for (const [table, cols] of Object.entries(backupColumns)) {
        const rows = file.data[table];
        if (!Array.isArray(rows) || rows.length > 50000)
            throw Error('Missing or oversized ' + table + ' records.');
        const ids = new Set();
        output[table] = rows.map((row) => {
            if (!row || typeof row !== 'object' || Array.isArray(row))
                throw Error('Invalid ' + table + ' record.');
            const copy = {};
            for (const col of cols) {
                const value = row[col];
                const numeric = table === 'settings' || col === 'amount';
                const nullable = ['member', 'period_end', 'exited'].includes(col);
                if (numeric) {
                    if (!Number.isSafeInteger(value) || value < 0 || value > 100000000)
                        throw Error('Invalid number in ' + table + '.');
                }
                else if (value === null && nullable) { }
                else if (typeof value !== 'string' || value.length > (col === 'photo' ? 350000 : col === 'notes' ? 1000 : 2000))
                    throw Error('Invalid field in ' + table + '.');
                if (['created', 'expires', 'entered', 'exited', 'period_end'].includes(col) && value !== null && !validDate(value))
                    throw Error('Invalid date in ' + table + '.');
                copy[col] = value;
            }
            const key = table === 'staff' ? copy.email : copy.id;
            if (!key || ids.has(key))
                throw Error('Duplicate or empty identifier in ' + table + '.');
            ids.add(key);
            if (table === 'staff' && (!['admin', 'secretary'].includes(copy.role) || copy.email !== copy.email.toLowerCase() || !/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(copy.email)))
                throw Error('Invalid staff account.');
            if (table === 'members' && (!copy.name || !copy.phone || (copy.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(copy.photo))))
                throw Error('Invalid client record.');
            if (table === 'payments' && (!['Registration', 'Renewal', 'Walk-in'].includes(copy.kind) || !['Cash', 'Mobile Money', 'Bank transfer'].includes(copy.method) || !copy.name))
                throw Error('Invalid payment record.');
            if (table === 'attendance' && (!['Member', 'Walk-in'].includes(copy.type) || !copy.name || (copy.exited && copy.exited < copy.entered)))
                throw Error('Invalid attendance record.');
            return copy;
        });
    }
    if (output.settings.length !== 1 || output.settings[0].id !== 1 || ['registration', 'monthly', 'walkin'].some(k => output.settings[0][k] < 1 || output.settings[0][k] > 100000))
        throw Error('Invalid membership fee settings.');
    const memberIds = new Set(output.members.map((r) => r.id)), open = new Set();
    for (const r of [...output.payments, ...output.attendance])
        if (r.member !== null && !memberIds.has(r.member))
            throw Error('A payment or visit refers to a missing client.');
    for (const r of output.attendance)
        if (r.member && !r.exited) {
            if (open.has(r.member))
                throw Error('Duplicate open attendance for a client.');
            open.add(r.member);
        }
    return output;
}

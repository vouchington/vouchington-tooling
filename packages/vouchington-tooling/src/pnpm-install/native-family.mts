const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46])
const PE = Buffer.from([0x4d, 0x5a])
const MACHO = [
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from([0xbe, 0xba, 0xfe, 0xca]),
]

export type NativeFamily = 'elf' | 'macho' | 'pe'

function startsWith(buffer: Buffer, magic: Buffer) {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)
}

export function nativeFamilyFromMagic(buffer: Buffer): NativeFamily | undefined {
  if (startsWith(buffer, ELF)) return 'elf'
  if (MACHO.some((magic) => startsWith(buffer, magic))) return 'macho'
  if (startsWith(buffer, PE)) return 'pe'
  return undefined
}

export function expectedNativeFamily(platform = process.platform): NativeFamily | undefined {
  if (platform === 'linux') return 'elf'
  if (platform === 'darwin') return 'macho'
  if (platform === 'win32') return 'pe'
  return undefined
}

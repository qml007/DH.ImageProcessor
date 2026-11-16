import writeXlsxFile from 'write-excel-file/node'

/**
 * 将档案信息写入 xlsx（Office Open XML 格式）。
 * headers 为表头（第一列固定为档案名称），rows 中每个数组对应一个档案。
 */
export async function writeArchivesExcel(
  filePath: string,
  headers: string[],
  rows: string[][]
): Promise<void> {
  const headerRow = headers.map((text) => ({
    value: text,
    fontWeight: 'bold' as const,
    backgroundColor: '#EFF3F8',
    align: 'center' as const
  }))

  const dataRows = rows.map((row) => row.map((value) => value))

  const columns = headers.map((header, index) => {
    const maxLength = rows.reduce(
      (max, row) => Math.max(max, (row[index] ?? '').length),
      header.length
    )
    return { width: Math.min(Math.max(maxLength + 4, 12), 40) }
  })

  await writeXlsxFile([headerRow, ...dataRows], {
    sheet: '档案信息',
    columns,
    stickyRowsCount: 1
  }).toFile(filePath)
}

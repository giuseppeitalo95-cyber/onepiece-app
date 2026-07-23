/* eslint-disable @typescript-eslint/no-explicit-any */

export type CardPoint = {
  x: number
  y: number
}

export type MultiCardDetection = {
  id: string
  corners: [CardPoint, CardPoint, CardPoint, CardPoint]
  crop: HTMLCanvasElement
  thumbnail: string
  score: number
  ocrText?: string
}

export type OcrPositionedWord = {
  text: string
  x: number
  y: number
  width: number
  height: number
}

type OpenCvModule = Record<string, any>

let openCvPromise: Promise<OpenCvModule> | null = null

const loadOpenCv = async () => {
  if (openCvPromise) return openCvPromise

  openCvPromise = new Promise<OpenCvModule>((resolve, reject) => {
    const finish = async () => {
      try {
        const candidate = (window as any).cv
        const cv = candidate instanceof Promise ? await candidate : candidate
        if (cv?.Mat) {
          resolve(cv)
          return
        }
        if (!cv) throw new Error('OpenCV non inizializzato')
        cv.onRuntimeInitialized = () => resolve(cv)
      } catch (error) {
        reject(error)
      }
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-opv-opencv]')
    if (existing) {
      void finish()
      return
    }

    const script = document.createElement('script')
    script.src = '/vendor/opencv-5.0.0.js'
    script.async = true
    script.dataset.opvOpencv = 'true'
    script.onload = () => void finish()
    script.onerror = () => reject(new Error('OpenCV non disponibile'))
    document.head.appendChild(script)
  })

  return openCvPromise
}

const distance = (first: CardPoint, second: CardPoint) =>
  Math.hypot(first.x - second.x, first.y - second.y)

const orderCorners = (points: CardPoint[]): [CardPoint, CardPoint, CardPoint, CardPoint] => {
  const bySum = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const topLeft = bySum[0]
  const bottomRight = bySum[bySum.length - 1]
  const remaining = points.filter(point => point !== topLeft && point !== bottomRight)
  const topRight = remaining[0].x - remaining[0].y > remaining[1].x - remaining[1].y
    ? remaining[0]
    : remaining[1]
  const bottomLeft = topRight === remaining[0] ? remaining[1] : remaining[0]
  const ordered: [CardPoint, CardPoint, CardPoint, CardPoint] = [topLeft, topRight, bottomRight, bottomLeft]

  const horizontal = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2
  const vertical = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2
  return horizontal <= vertical
    ? ordered
    : [bottomLeft, topLeft, topRight, bottomRight]
}

const boundsForCorners = (corners: CardPoint[]) => {
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

const intersectionOverUnion = (first: CardPoint[], second: CardPoint[]) => {
  const a = boundsForCorners(first)
  const b = boundsForCorners(second)
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const intersection = width * height
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

const rotateCanvas180 = (source: HTMLCanvasElement) => {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context) return source
  context.translate(canvas.width, canvas.height)
  context.rotate(Math.PI)
  context.drawImage(source, 0, 0)
  return canvas
}

const warpCard = (
  cv: OpenCvModule,
  source: any,
  corners: [CardPoint, CardPoint, CardPoint, CardPoint],
  width = 600,
  height = 840
) => {
  const destination = new cv.Mat()
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(point => [point.x, point.y]))
  const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width - 1, 0,
    width - 1, height - 1,
    0, height - 1,
  ])
  const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints)
  cv.warpPerspective(
    source,
    destination,
    transform,
    new cv.Size(width, height),
    cv.INTER_CUBIC,
    cv.BORDER_REPLICATE
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  cv.imshow(canvas, destination)

  destination.delete()
  sourcePoints.delete()
  destinationPoints.delete()
  transform.delete()
  return canvas
}

type Candidate = {
  corners: [CardPoint, CardPoint, CardPoint, CardPoint]
  score: number
  centerX: number
  centerY: number
}

const translatedCorners = (
  corners: [CardPoint, CardPoint, CardPoint, CardPoint],
  offsetX: number,
  offsetY: number
) => corners.map(point => ({
  x: point.x + offsetX,
  y: point.y + offsetY,
})) as [CardPoint, CardPoint, CardPoint, CardPoint]

const normalizedVector = (x: number, y: number) => {
  const length = Math.max(1, Math.hypot(x, y))
  return { x: x / length, y: y / length }
}

const inferBinderGrid = (
  cv: OpenCvModule,
  edgeImage: any,
  selected: Candidate[],
  sourceWidth: number,
  sourceHeight: number,
  analysisScale: number,
  maximumCards: number
) => {
  if (selected.length === 0 || selected.length > 3 || selected.length >= maximumCards) return selected

  const anchor = [...selected].sort((first, second) => second.score - first.score)[0]
  const anchorBounds = boundsForCorners(anchor.corners)
  const widthRatio = anchorBounds.width / sourceWidth
  const heightRatio = anchorBounds.height / sourceHeight
  if (widthRatio < 0.17 || widthRatio > 0.42 || heightRatio < 0.18 || heightRatio > 0.46) {
    return selected
  }

  const horizontal = normalizedVector(
    (anchor.corners[1].x - anchor.corners[0].x) + (anchor.corners[2].x - anchor.corners[3].x),
    (anchor.corners[1].y - anchor.corners[0].y) + (anchor.corners[2].y - anchor.corners[3].y)
  )
  const vertical = normalizedVector(
    (anchor.corners[3].x - anchor.corners[0].x) + (anchor.corners[2].x - anchor.corners[1].x),
    (anchor.corners[3].y - anchor.corners[0].y) + (anchor.corners[2].y - anchor.corners[1].y)
  )
  if (Math.abs(horizontal.x) < 0.9 || Math.abs(vertical.y) < 0.9) return selected

  const cardWidth = (
    distance(anchor.corners[0], anchor.corners[1]) +
    distance(anchor.corners[3], anchor.corners[2])
  ) / 2
  const cardHeight = (
    distance(anchor.corners[0], anchor.corners[3]) +
    distance(anchor.corners[1], anchor.corners[2])
  ) / 2
  const horizontalStep = cardWidth * 1.12
  const verticalStep = cardHeight * 1.1
  const proposals: Candidate[] = []

  for (let rowOffset = -4; rowOffset <= 4; rowOffset += 1) {
    for (let columnOffset = -4; columnOffset <= 4; columnOffset += 1) {
      const offsetX =
        horizontal.x * horizontalStep * columnOffset +
        vertical.x * verticalStep * rowOffset
      const offsetY =
        horizontal.y * horizontalStep * columnOffset +
        vertical.y * verticalStep * rowOffset
      const corners = translatedCorners(anchor.corners, offsetX, offsetY)
      const bounds = boundsForCorners(corners)
      const marginX = sourceWidth * 0.015
      const marginY = sourceHeight * 0.015
      if (
        bounds.left < -marginX ||
        bounds.top < -marginY ||
        bounds.right > sourceWidth + marginX ||
        bounds.bottom > sourceHeight + marginY
      ) continue

      const roiX = Math.max(0, Math.floor(bounds.left * analysisScale))
      const roiY = Math.max(0, Math.floor(bounds.top * analysisScale))
      const roiWidth = Math.min(
        edgeImage.cols - roiX,
        Math.max(1, Math.floor(bounds.width * analysisScale))
      )
      const roiHeight = Math.min(
        edgeImage.rows - roiY,
        Math.max(1, Math.floor(bounds.height * analysisScale))
      )
      if (roiWidth < 20 || roiHeight < 20) continue

      const roi = edgeImage.roi(new cv.Rect(roiX, roiY, roiWidth, roiHeight))
      const edgeDensity = cv.countNonZero(roi) / Math.max(1, roiWidth * roiHeight)
      roi.delete()
      if (edgeDensity < 0.035) continue

      proposals.push({
        corners,
        score: anchor.score * (0.75 + Math.min(0.2, edgeDensity)),
        centerX: anchor.centerX + offsetX,
        centerY: anchor.centerY + offsetY,
      })
    }
  }

  const distinctRows = new Set(proposals.map(candidate => Math.round(candidate.centerY / verticalStep))).size
  const distinctColumns = new Set(proposals.map(candidate => Math.round(candidate.centerX / horizontalStep))).size
  if (proposals.length < 4 || distinctRows < 2 || distinctColumns < 2) return selected

  const grid = proposals
    .sort((first, second) => first.centerY - second.centerY || first.centerX - second.centerX)
    .slice(0, maximumCards)
  const extras = selected.filter(candidate => {
    const candidateBounds = boundsForCorners(candidate.corners)
    return !grid.some(gridCandidate => {
      const gridBounds = boundsForCorners(gridCandidate.corners)
      const centerInside =
        candidate.centerX >= gridBounds.left &&
        candidate.centerX <= gridBounds.right &&
        candidate.centerY >= gridBounds.top &&
        candidate.centerY <= gridBounds.bottom
      return centerInside && candidateBounds.width * candidateBounds.height < gridBounds.width * gridBounds.height * 0.7
    })
  })

  return [...grid, ...extras]
    .filter((candidate, index, all) =>
      all.findIndex(other => intersectionOverUnion(other.corners, candidate.corners) > 0.55) === index
    )
    .slice(0, maximumCards)
}

const rotatedRectCorners = (rect: any): CardPoint[] => {
  const angle = Number(rect?.angle || 0) * Math.PI / 180
  const halfWidth = Number(rect?.size?.width || 0) / 2
  const halfHeight = Number(rect?.size?.height || 0) / 2
  const centerX = Number(rect?.center?.x || 0)
  const centerY = Number(rect?.center?.y || 0)
  const widthX = Math.cos(angle) * halfWidth
  const widthY = Math.sin(angle) * halfWidth
  const heightX = -Math.sin(angle) * halfHeight
  const heightY = Math.cos(angle) * halfHeight

  return [
    { x: centerX - widthX - heightX, y: centerY - widthY - heightY },
    { x: centerX + widthX - heightX, y: centerY + widthY - heightY },
    { x: centerX + widthX + heightX, y: centerY + widthY + heightY },
    { x: centerX - widthX + heightX, y: centerY - widthY + heightY },
  ]
}

export const detectCardsInPhoto = async (
  sourceCanvas: HTMLCanvasElement,
  maximumCards = 12
): Promise<MultiCardDetection[]> => {
  const cv = await loadOpenCv()
  const analysisMax = 1500
  const scale = Math.min(1, analysisMax / Math.max(sourceCanvas.width, sourceCanvas.height))
  const analysisCanvas = document.createElement('canvas')
  analysisCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale))
  analysisCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const analysisContext = analysisCanvas.getContext('2d')
  if (!analysisContext) throw new Error('Canvas di analisi non disponibile')
  analysisContext.drawImage(sourceCanvas, 0, 0, analysisCanvas.width, analysisCanvas.height)

  const source = cv.imread(sourceCanvas)
  const analysis = cv.imread(analysisCanvas)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const closed = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  const candidates: Candidate[] = []

  try {
    cv.cvtColor(analysis, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 38, 118)
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2)
    cv.dilate(closed, closed, kernel, new cv.Point(-1, -1), 1)
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    const imageArea = analysisCanvas.width * analysisCanvas.height
    const minimumArea = imageArea * 0.006
    const maximumArea = imageArea * 0.72

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index)
      const area = Math.abs(cv.contourArea(contour))
      if (area < minimumArea || area > maximumArea) {
        contour.delete()
        continue
      }

      const perimeter = cv.arcLength(contour, true)
      let bestApprox: any = null
      for (const epsilonRatio of [0.015, 0.02, 0.025, 0.03, 0.04]) {
        const approx = new cv.Mat()
        cv.approxPolyDP(contour, approx, perimeter * epsilonRatio, true)
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          bestApprox = approx
          break
        }
        approx.delete()
      }

      const rawPoints: CardPoint[] = []
      let partialBorder = false
      if (bestApprox) {
        for (let pointIndex = 0; pointIndex < 4; pointIndex += 1) {
          rawPoints.push({
            x: bestApprox.data32S[pointIndex * 2],
            y: bestApprox.data32S[pointIndex * 2 + 1],
          })
        }
        bestApprox.delete()
      } else {
        const rotatedRect = cv.minAreaRect(contour)
        rawPoints.push(...rotatedRectCorners(rotatedRect))
        partialBorder = true
      }
      contour.delete()

      const ordered = orderCorners(rawPoints)
      const width = (distance(ordered[0], ordered[1]) + distance(ordered[3], ordered[2])) / 2
      const height = (distance(ordered[0], ordered[3]) + distance(ordered[1], ordered[2])) / 2
      const shortSide = Math.min(width, height)
      const longSide = Math.max(width, height)
      const aspect = shortSide / Math.max(longSide, 1)
      const rectangularity = area / Math.max(width * height, 1)
      const minimumRectangularity = partialBorder ? 0.42 : 0.58
      if (shortSide < 55 || aspect < 0.55 || aspect > 0.84 || rectangularity < minimumRectangularity) continue

      const sourceCorners = ordered.map(point => ({
        x: point.x / scale,
        y: point.y / scale,
      })) as [CardPoint, CardPoint, CardPoint, CardPoint]
      const centerX = sourceCorners.reduce((sum, point) => sum + point.x, 0) / 4
      const centerY = sourceCorners.reduce((sum, point) => sum + point.y, 0) / 4
      const aspectScore = 1 - Math.min(1, Math.abs(aspect - 0.714) / 0.18)
      candidates.push({
        corners: sourceCorners,
        score: area * Math.max(0.2, rectangularity) * Math.max(0.25, aspectScore) * (partialBorder ? 0.88 : 1),
        centerX,
        centerY,
      })
    }

    const selected: Candidate[] = []
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (selected.some(existing => intersectionOverUnion(existing.corners, candidate.corners) > 0.55)) continue
      selected.push(candidate)
      if (selected.length >= maximumCards) break
    }

    const completedSelection = inferBinderGrid(
      cv,
      edges,
      selected,
      sourceCanvas.width,
      sourceCanvas.height,
      scale,
      maximumCards
    )

    completedSelection.sort((a, b) => {
      const rowTolerance = Math.max(sourceCanvas.height * 0.08, 80)
      return Math.abs(a.centerY - b.centerY) > rowTolerance
        ? a.centerY - b.centerY
        : a.centerX - b.centerX
    })

    return completedSelection.map((candidate, index) => {
      const crop = warpCard(cv, source, candidate.corners)
      return {
        id: `detected-${Date.now()}-${index}`,
        corners: candidate.corners,
        crop,
        thumbnail: crop.toDataURL('image/jpeg', 0.82),
        score: candidate.score,
      }
    })
  } finally {
    source.delete()
    analysis.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    closed.delete()
    contours.delete()
    hierarchy.delete()
    kernel.delete()
  }
}

export const createDetectionPreview = (
  sourceCanvas: HTMLCanvasElement,
  detections: MultiCardDetection[]
) => {
  const maximumDimension = 1400
  const scale = Math.min(1, maximumDimension / Math.max(sourceCanvas.width, sourceCanvas.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale))
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return ''

  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height)
  context.lineJoin = 'round'
  context.font = '700 24px system-ui'

  detections.forEach((detection, index) => {
    const corners = detection.corners.map(point => ({ x: point.x * scale, y: point.y * scale }))
    context.beginPath()
    context.moveTo(corners[0].x, corners[0].y)
    corners.slice(1).forEach(point => context.lineTo(point.x, point.y))
    context.closePath()
    context.fillStyle = 'rgba(34, 211, 238, 0.12)'
    context.fill()
    context.strokeStyle = '#67e8f9'
    context.lineWidth = 5
    context.stroke()

    const labelX = corners[0].x
    const labelY = corners[0].y
    context.fillStyle = '#020617'
    context.beginPath()
    context.arc(labelX, labelY, 22, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#f8fafc'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(index + 1), labelX, labelY + 1)
  })

  return canvas.toDataURL('image/jpeg', 0.88)
}

export type OcrSheetRegion = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export const buildMultiCardOcrSheet = (
  detections: MultiCardDetection[],
  sourceCanvas: HTMLCanvasElement
) => {
  const cellWidth = 600
  const cellHeight = 840
  const gap = 36
  const oriented = detections.flatMap((detection, index) => [
    { id: `${index}:0`, canvas: detection.crop },
    { id: `${index}:180`, canvas: rotateCanvas180(detection.crop) },
  ])
  const columns = oriented.length <= 4 ? 2 : 4
  const rows = Math.ceil(oriented.length / columns)
  const sourceScale = Math.min(1, 1400 / Math.max(sourceCanvas.width, sourceCanvas.height))
  const sourceWidth = Math.max(1, Math.round(sourceCanvas.width * sourceScale))
  const sourceHeight = Math.max(1, Math.round(sourceCanvas.height * sourceScale))
  const gridWidth = oriented.length > 0 ? gap + columns * (cellWidth + gap) : 0
  const gridHeight = oriented.length > 0 ? rows * (cellHeight + gap) : 0
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(sourceWidth + gap * 2, gridWidth)
  canvas.height = sourceHeight + gap * 3 + gridHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Impossibile comporre le carte')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const regions: OcrSheetRegion[] = []
  const sourceX = Math.round((canvas.width - sourceWidth) / 2)
  context.drawImage(sourceCanvas, sourceX, gap, sourceWidth, sourceHeight)
  regions.push({
    id: 'source',
    x: sourceX,
    y: gap,
    width: sourceWidth,
    height: sourceHeight,
  })

  const gridStartY = sourceHeight + gap * 2
  oriented.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = gap + column * (cellWidth + gap)
    const y = gridStartY + row * (cellHeight + gap)
    context.drawImage(item.canvas, x, y, cellWidth, cellHeight)
    regions.push({ id: item.id, x, y, width: cellWidth, height: cellHeight })
  })

  return { canvas, regions }
}

export type OcrLayout = {
  columns: number
  rows: number
  score: number
  confidence: number
  occupiedCells: number
  cellWeights: number[]
  wordCells: number[]
}

const meaningfulWordWeight = (value: string) => {
  const compact = value.replace(/[^a-z0-9]/gi, '')
  return compact.length >= 1 ? Math.min(12, compact.length) : 0
}

type AxisClustering = {
  centers: number[]
  assignments: number[]
  quality: number
}

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const clusterAxis = (values: number[], clusterCount: number): AxisClustering | null => {
  if (clusterCount < 1 || values.length < clusterCount) return null
  if (clusterCount === 1) {
    return {
      centers: [values.reduce((sum, value) => sum + value, 0) / values.length],
      assignments: values.map(() => 0),
      quality: 0.48,
    }
  }

  const sortedValues = [...values].sort((first, second) => first - second)
  let centers = Array.from({ length: clusterCount }, (_, index) => {
    const quantileIndex = Math.min(
      sortedValues.length - 1,
      Math.max(0, Math.round(((index + 0.5) / clusterCount) * sortedValues.length - 0.5))
    )
    return sortedValues[quantileIndex]
  })
  let assignments = values.map(() => 0)

  for (let iteration = 0; iteration < 24; iteration += 1) {
    assignments = values.map(value => {
      let nearest = 0
      let nearestDistance = Number.POSITIVE_INFINITY
      centers.forEach((center, index) => {
        const currentDistance = Math.abs(value - center)
        if (currentDistance < nearestDistance) {
          nearest = index
          nearestDistance = currentDistance
        }
      })
      return nearest
    })

    const nextCenters = centers.map((center, index) => {
      const members = values.filter((_, valueIndex) => assignments[valueIndex] === index)
      return members.length > 0
        ? members.reduce((sum, value) => sum + value, 0) / members.length
        : center
    })
    const movement = nextCenters.reduce(
      (sum, center, index) => sum + Math.abs(center - centers[index]),
      0
    )
    centers = nextCenters
    if (movement < 0.0001) break
  }

  const orderedCenters = centers
    .map((center, originalIndex) => ({ center, originalIndex }))
    .sort((first, second) => first.center - second.center)
  const indexMap = new Map(
    orderedCenters.map((item, index) => [item.originalIndex, index])
  )
  centers = orderedCenters.map(item => item.center)
  assignments = assignments.map(index => indexMap.get(index) ?? index)

  const clusterSizes = centers.map((_, index) =>
    assignments.filter(assignment => assignment === index).length
  )
  if (clusterSizes.some(size => size === 0)) return null

  const gaps = centers.slice(1).map((center, index) => center - centers[index])
  if (Math.min(...gaps) < 0.075) return null

  const silhouettes = values.map((value, valueIndex) => {
    const ownCluster = assignments[valueIndex]
    const ownMembers = values.filter((_, index) =>
      index !== valueIndex && assignments[index] === ownCluster
    )
    const ownDistance = ownMembers.length > 0
      ? ownMembers.reduce((sum, member) => sum + Math.abs(value - member), 0) / ownMembers.length
      : 0
    const otherDistance = Math.min(
      ...centers
        .map((_, clusterIndex) => clusterIndex)
        .filter(clusterIndex => clusterIndex !== ownCluster)
        .map(clusterIndex => {
          const members = values.filter((_, index) => assignments[index] === clusterIndex)
          return members.reduce((sum, member) => sum + Math.abs(value - member), 0) / members.length
        })
    )
    return otherDistance > 0
      ? (otherDistance - ownDistance) / Math.max(otherDistance, ownDistance)
      : 0
  })
  const silhouette = silhouettes.reduce((sum, value) => sum + value, 0) / silhouettes.length
  const minimumShare = Math.min(...clusterSizes) / values.length
  const tinyClusterPenalty = Math.max(0, 0.08 - minimumShare) * 3
  const complexityPenalty = (clusterCount - 1) * 0.035

  return {
    centers,
    assignments,
    quality: silhouette - tinyClusterPenalty - complexityPenalty,
  }
}

export const detectOcrGridLayout = (
  words: OcrPositionedWord[],
  sourceWidth: number,
  sourceHeight: number,
  maximumCards: number
) => {
  let best: OcrLayout | null = null
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight)
  const horizontalValues = words.map(word => word.x + word.width / 2)
  const verticalValues = words.map(word => word.y + word.height / 2)
  const horizontalClusters = Array.from({ length: 4 }, (_, index) =>
    clusterAxis(horizontalValues, index + 1)
  )
  const verticalClusters = Array.from({ length: 4 }, (_, index) =>
    clusterAxis(verticalValues, index + 1)
  )

  for (let rows = 1; rows <= 4; rows += 1) {
    for (let columns = 1; columns <= 4; columns += 1) {
      const horizontal = horizontalClusters[columns - 1]
      const vertical = verticalClusters[rows - 1]
      if (!horizontal || !vertical) continue

      let physicalRows = rows
      let physicalColumns = columns
      const clusteredCardAspect = sourceAspect * rows / columns
      if (clusteredCardAspect < 0.58) {
        const expectedRows = Math.max(
          rows,
          Math.min(4, Math.round(0.714 * columns / sourceAspect))
        )
        if (expectedRows * columns <= maximumCards) physicalRows = expectedRows
      } else if (clusteredCardAspect > 0.9) {
        const expectedColumns = Math.max(
          columns,
          Math.min(4, Math.round(sourceAspect * rows / 0.714))
        )
        if (rows * expectedColumns <= maximumCards) physicalColumns = expectedColumns
      }

      const columnSlots = horizontal.centers.map(center =>
        Math.min(
          physicalColumns - 1,
          Math.max(0, Math.round(center * physicalColumns - 0.5))
        )
      )
      const rowSlots = vertical.centers.map(center =>
        Math.min(
          physicalRows - 1,
          Math.max(0, Math.round(center * physicalRows - 0.5))
        )
      )
      if (
        new Set(columnSlots).size !== columns ||
        new Set(rowSlots).size !== rows
      ) {
        physicalRows = rows
        physicalColumns = columns
        columnSlots.splice(0, columnSlots.length, ...horizontal.centers.map((_, index) => index))
        rowSlots.splice(0, rowSlots.length, ...vertical.centers.map((_, index) => index))
      }

      const totalCells = physicalRows * physicalColumns
      if (totalCells < 2 || totalCells > maximumCards) continue

      const cardAspect = sourceAspect * physicalRows / physicalColumns
      if (cardAspect < 0.34 || cardAspect > 1.35) continue

      const cellWeights = new Array(totalCells).fill(0)
      const wordCells = words.map((_, index) => {
        const column = columnSlots[horizontal.assignments[index]]
        const row = rowSlots[vertical.assignments[index]]
        return row * physicalColumns + column
      })
      words.forEach((word, index) => {
        const weight = meaningfulWordWeight(word.text)
        if (weight === 0) return
        cellWeights[wordCells[index]] += weight
      })

      const occupiedCells = cellWeights.filter(weight => weight >= 3).length
      const occupancyRatio = occupiedCells / totalCells
      if (occupiedCells < 2) continue

      const sourceAspectScore = Math.exp(-Math.abs(Math.log(cardAspect / 0.714)) * 2.2)
      const horizontalSpacing = median(
        horizontal.centers.slice(1).map((center, index) =>
          (center - horizontal.centers[index]) * sourceWidth
        )
      )
      const verticalSpacing = median(
        vertical.centers.slice(1).map((center, index) =>
          (center - vertical.centers[index]) * sourceHeight
        )
      )
      const spacingAspect = horizontalSpacing > 0 && verticalSpacing > 0
        ? horizontalSpacing / verticalSpacing
        : cardAspect
      const spacingAspectScore = Math.exp(
        -Math.abs(Math.log(Math.max(0.01, spacingAspect) / 0.714)) * 2.6
      )
      const balance = cellWeights
        .filter(weight => weight >= 3)
        .reduce((sum, weight) => sum + Math.min(1, weight / 12), 0) / occupiedCells
      const score =
        horizontal.quality +
        vertical.quality +
        spacingAspectScore * 0.48 +
        sourceAspectScore * 0.26 +
        Math.sqrt(occupancyRatio) * 0.12 +
        Math.log1p(occupiedCells) * 0.08 +
        balance * 0.08
      const confidence = Math.max(
        0,
        Math.min(
          1,
          0.35 +
          Math.max(0, horizontal.quality) * 0.18 +
          Math.max(0, vertical.quality) * 0.18 +
          spacingAspectScore * 0.16 +
          sourceAspectScore * 0.08 +
          Math.sqrt(occupancyRatio) * 0.12
        )
      )

      if (!best || score > best.score) {
        best = {
          columns: physicalColumns,
          rows: physicalRows,
          score,
          confidence,
          occupiedCells,
          cellWeights,
          wordCells,
        }
      }
    }
  }

  return best
}

export const inferCardsFromOcrLayout = async (
  sourceCanvas: HTMLCanvasElement,
  words: OcrPositionedWord[],
  maximumCards = 12
) => {
  const usableWords = words.filter(word =>
    Number.isFinite(word.x) &&
    Number.isFinite(word.y) &&
    word.x >= 0 &&
    word.x <= 1 &&
    word.y >= 0 &&
    word.y <= 1 &&
    meaningfulWordWeight(word.text) > 0
  )
  if (usableWords.length < 4) return { detections: [] as MultiCardDetection[], confidence: 0 }

  const layout = detectOcrGridLayout(
    usableWords,
    sourceCanvas.width,
    sourceCanvas.height,
    maximumCards
  )
  if (!layout) return { detections: [] as MultiCardDetection[], confidence: 0 }

  const cv = await loadOpenCv()
  const source = cv.imread(sourceCanvas)
  const detections: MultiCardDetection[] = []
  const cellWidth = sourceCanvas.width / layout.columns
  const cellHeight = sourceCanvas.height / layout.rows
  const horizontalInset = cellWidth * 0.035
  const verticalInset = cellHeight * 0.025

  try {
    for (let row = 0; row < layout.rows; row += 1) {
      for (let column = 0; column < layout.columns; column += 1) {
        const cellIndex = row * layout.columns + column
        if (layout.cellWeights[cellIndex] < 3) continue

        const left = column * cellWidth + horizontalInset
        const top = row * cellHeight + verticalInset
        const right = (column + 1) * cellWidth - horizontalInset
        const bottom = (row + 1) * cellHeight - verticalInset
        const corners: [CardPoint, CardPoint, CardPoint, CardPoint] = [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ]
        const crop = warpCard(cv, source, corners)
        const cellWords = usableWords.filter((_, index) =>
          layout.wordCells[index] === cellIndex
        )

        detections.push({
          id: `ocr-grid-${row}-${column}`,
          corners,
          crop,
          thumbnail: crop.toDataURL('image/jpeg', 0.82),
          score: layout.score,
          ocrText: cellWords
            .sort((first, second) => first.y - second.y || first.x - second.x)
            .map(word => word.text)
            .join(' ')
            .trim(),
        })
      }
    }
  } finally {
    source.delete()
  }

  return { detections, confidence: layout.confidence }
}

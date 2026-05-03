'use client'

import { EwCalculationResult } from '@/lib/ew-calculator'
import CopyButton from './CopyButton'

interface CalculationPreviewProps {
  result: EwCalculationResult | null
  error: string | null
}

export default function CalculationPreview({ result, error }: CalculationPreviewProps) {
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h3 className="text-sm font-medium text-red-800">계산 오류</h3>
        <p className="mt-2 text-sm text-red-700">{error}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 flex items-center justify-center h-full min-h-[200px]">
        <p className="text-sm text-gray-500">필수 항목을 모두 입력하면 결과가 표시됩니다.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden sticky top-6">
      <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg leading-6 font-medium text-gray-900">계산 결과</h3>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">실근무시간</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{result.actualWorkText}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">차감시간</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{result.deductionMinutes / 60}시간</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">EW 시간/코드</p>
            <p className="mt-1 text-lg font-semibold text-blue-600">{result.ewValue}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-2">복사용 문구 미리보기</p>
          <div className="bg-gray-100 p-3 rounded text-sm font-mono text-gray-800 break-words whitespace-pre-wrap">
            {result.copyText}
          </div>
        </div>
      </div>
    </div>
  )
}

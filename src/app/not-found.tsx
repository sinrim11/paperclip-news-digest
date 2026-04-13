export default function NotFound() {
  return (
    <div className="text-center py-20 text-gray-400">
      <p className="text-6xl mb-4">🔍</p>
      <p className="text-xl">페이지를 찾을 수 없습니다.</p>
      <a href="/" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
        홈으로 돌아가기
      </a>
    </div>
  );
}

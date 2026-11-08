import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";

export default function DirectoryPagination({
	page,
	totalPages,
	start,
	end,
	total,
	pageSize,
	onPageChange,
	onPageSizeChange,
	unit = "项目",
}: {
	page: number;
	totalPages: number;
	start: number;
	end: number;
	total: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
	unit?: string;
}) {
	return (
		<div className="directory-pagination">
			<div className="directory-pagination-summary">
				<p>
					显示 {start}–{end} 项，共 {total} 个{unit}
				</p>
				<label>
					每页{" "}
					<select
						aria-label={`每页${unit}数量`}
						value={pageSize}
						onChange={(event) => onPageSizeChange(Number(event.target.value))}
					>
						{[10, 20, 50].map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>{" "}
					项
				</label>
			</div>
			<nav aria-label={`${unit}分页`} className="directory-page-controls">
				<button
					type="button"
					aria-label="上一页"
					disabled={page === 1}
					onClick={() => onPageChange(page - 1)}
				>
					<CaretLeftIcon size={16} />
					<span>上一页</span>
				</button>
				{Array.from({ length: totalPages }, (_, i) => i + 1)
					.filter(
						(number) =>
							number === 1 ||
							number === totalPages ||
							Math.abs(number - page) <= 1,
					)
					.map((number, index, pages) => (
						<span key={number} className="directory-page-item">
							{index > 0 && number - pages[index - 1] > 1 && (
								<span className="directory-page-gap" aria-hidden="true">
									…
								</span>
							)}
							<button
								type="button"
								aria-label={`第 ${number} 页`}
								aria-current={number === page ? "page" : undefined}
								onClick={() => onPageChange(number)}
							>
								{number}
							</button>
						</span>
					))}
				<button
					type="button"
					aria-label="下一页"
					disabled={page === totalPages}
					onClick={() => onPageChange(page + 1)}
				>
					<span>下一页</span>
					<CaretRightIcon size={16} />
				</button>
			</nav>
		</div>
	);
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Image, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@ux/button";
import XThickIcon from "@ux/icon/x-thick";

import type { DefaultToolRendererProps } from "@/app/develop/components/tool-renderers/DefaultToolRenderer";
import ToolHeader from "@/app/develop/components/tool-renderers/ToolHeader";
import { logger } from "@/lib/request-context";

interface MediaSlotInput {
	slot: string;
	query: string;
	mediaType?: "image" | "video";
	size?: {
		width: number;
		height: number;
		fit?: "cover" | "contain" | "crop";
	};
	orientations?: string;
	compositions?: string;
	count?: number;
}

interface MediaSlotResultData {
	success: boolean;
	slot: string;
	slotUrl: string;
	mediaType: "image" | "video";
	searchQuery: string;
	resolvedUrl?: string;
	/** For videos: thumbnail image URL for preview display */
	thumbnailUrl?: string;
	alternatives?: string[];
	alternativeCount?: number;
	error?: string;
}

/**
 * Custom renderer for media slot tool
 *
 * Shows a compact card with slot name and primary image.
 * Click to open an attached modal showing search details,
 * current image, and alternatives for swapping.
 */
export default function MediaSlotToolRenderer({
	toolStatus,
	input,
	result,
}: DefaultToolRendererProps) {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [selectedImageIndex, setSelectedImageIndex] = useState(0);
	const cardRef = useRef<HTMLButtonElement>(null);
	const modalVideoRef = useRef<HTMLVideoElement>(null);
	const [cardRect, setCardRect] = useState<DOMRect | null>(null);

	// Parse input
	const parsedInput: MediaSlotInput | null =
		input as unknown as MediaSlotInput | null;

	// Parse result
	let parsedResult: MediaSlotResultData | null = null;
	if (result) {
		try {
			if (typeof result === "string") {
				parsedResult = JSON.parse(result) as MediaSlotResultData;
			} else {
				parsedResult = result as unknown as MediaSlotResultData;
			}
		} catch (e) {
			logger.error("tool.media_slot.parse.failed", {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	const hasResult = parsedResult?.success && parsedResult?.resolvedUrl;
	const isVideo = parsedResult?.mediaType === "video";
	// For videos, use thumbnailUrl for preview; for images, use resolvedUrl
	const previewUrl = isVideo
		? parsedResult?.thumbnailUrl || parsedResult?.resolvedUrl
		: parsedResult?.resolvedUrl;
	const allImages = hasResult
		? [parsedResult!.resolvedUrl!, ...(parsedResult!.alternatives || [])]
		: [];

	// Helper to ensure URLs have proper protocol
	const ensureHttps = (url: string): string => {
		if (!url) return url;
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return url;
		}
		return `https://${url}`;
	};

	// Get card position for attached modal
	const updateCardRect = useCallback(() => {
		if (cardRef.current) {
			setCardRect(cardRef.current.getBoundingClientRect());
		}
	}, []);

	const handleOpenModal = (imageIndex: number = 0) => {
		updateCardRect();
		setSelectedImageIndex(imageIndex);
		setIsModalOpen(true);
	};

	const handleCloseModal = () => {
		// Pause video when closing modal
		if (modalVideoRef.current) {
			modalVideoRef.current.pause();
		}
		setIsModalOpen(false);
	};

	const handleSwapImage = () => {
		// Move selected image to be the current one
		// In a full implementation, this would call an API to update the manifest
		// For now, just show the swap action
		logger.info("tool.media_slot.swap_requested", {
			slot: parsedResult?.slot,
			newImageIndex: selectedImageIndex,
		});
	};

	// Update card rect on scroll/resize
	useEffect(() => {
		if (!isModalOpen) return;

		const handleUpdate = () => updateCardRect();
		window.addEventListener("scroll", handleUpdate, true);
		window.addEventListener("resize", handleUpdate);

		return () => {
			window.removeEventListener("scroll", handleUpdate, true);
			window.removeEventListener("resize", handleUpdate);
		};
	}, [isModalOpen, updateCardRect]);

	// Format slot name for display (e.g., "pages/home/hero" -> "Home Hero")
	const formatSlotName = (slot: string): string => {
		return slot
			.split("/")
			.filter(
				(part) =>
					part &&
					part !== "pages" &&
					part !== "components" &&
					part !== "sections",
			)
			.map(
				(part) =>
					part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, " "),
			)
			.join(" ");
	};

	// Build attribute pills
	const attributePills: { label: string; value: string }[] = [];
	if (parsedInput?.mediaType && parsedInput.mediaType !== "image") {
		attributePills.push({ label: "Type", value: parsedInput.mediaType });
	}
	if (parsedInput?.orientations) {
		attributePills.push({
			label: "Orientation",
			value: parsedInput.orientations,
		});
	}
	if (parsedInput?.compositions) {
		attributePills.push({
			label: "Composition",
			value: parsedInput.compositions,
		});
	}
	if (parsedInput?.size) {
		attributePills.push({
			label: "Size",
			value: `${parsedInput.size.width}x${parsedInput.size.height}`,
		});
	}

	// Calculate modal position - match preview pane container dimensions
	const getModalPosition = () => {
		// Find the preview pane container (always exists, even during loading)
		const previewContainer = document.getElementById("preview-pane-container");

		if (previewContainer) {
			const containerRect = previewContainer.getBoundingClientRect();
			return {
				top: containerRect.top,
				left: containerRect.left,
				maxWidth: containerRect.width * 0.9,
				maxHeight: containerRect.height,
			};
		}

		// Fallback if preview not found
		const padding = 16;
		const viewportHeight = window.innerHeight;
		return {
			top: padding,
			left: padding,
			maxWidth: 850,
			maxHeight: viewportHeight - padding * 2,
		};
	};

	const modalPosition = cardRect ? getModalPosition() : null;

	const modalContent = typeof document !== "undefined" &&
		cardRect &&
		modalPosition && (
			<AnimatePresence>
				{isModalOpen && (
					<>
						{/* Backdrop */}
						<motion.div
							className="fixed inset-0 z-40 bg-black/40"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.15 }}
							onClick={handleCloseModal}
						/>

						{/* Attached Modal - positioned to the right of the card */}
						<motion.div
							className="fixed z-50 bg-intents-ux-box-backgroundColor rounded-lg shadow-xl overflow-hidden flex flex-col"
							style={{
								top: modalPosition.top,
								left: modalPosition.left,
								maxWidth: modalPosition.maxWidth,
								maxHeight: modalPosition.maxHeight,
							}}
							initial={{ opacity: 0, scale: 0.95, x: -10 }}
							animate={{ opacity: 1, scale: 1, x: 0 }}
							exit={{ opacity: 0, scale: 0.95, x: -10 }}
							transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
							onClick={(e) => e.stopPropagation()}
						>
							{/* Header */}
							<div className="flex items-start justify-between p-3">
								<div className="flex-1 min-w-0">
									{/* Title row with pills */}
									<div className="flex items-center gap-2 flex-wrap">
										<p className="font-semibold text-sm">
											{formatSlotName(parsedResult?.slot || "")}
										</p>
										{/* Attribute pills */}
										{attributePills.length > 0 &&
											attributePills.map((pill, index) => (
												<span
													key={index}
													className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor"
												>
													<span className="font-medium mr-1">
														{pill.label}:
													</span>
													{pill.value}
												</span>
											))}
									</div>
									<p className="text-sm text-intents-ux-textSubtle-textColor mt-0.5">
										&ldquo;{parsedResult?.searchQuery}&rdquo;
									</p>
								</div>
								<Button
									onClick={handleCloseModal}
									icon={<XThickIcon className="h-3 w-3" />}
									design="control"
									aria-label="Close"
									size="sm"
									className="flex-shrink-0 ml-2"
								/>
							</div>

							{/* Content */}
							<div className="p-3 overflow-y-auto flex-1">
								{/* Main preview - video player for videos, image for images */}
								<div className="group/preview relative aspect-[4/3] rounded-lg overflow-hidden bg-intents-ux-boxLowContrast-backgroundColor max-h-80">
									{isVideo ? (
										/* Video player with thumbnail poster */
										/* eslint-disable-next-line jsx-a11y/media-has-caption */
										<video
											ref={modalVideoRef}
											src={ensureHttps(allImages[selectedImageIndex] || "")}
											poster={
												parsedResult?.thumbnailUrl
													? ensureHttps(parsedResult.thumbnailUrl)
													: undefined
											}
											className="w-full h-full object-contain"
											controls
										/>
									) : (
										/* Image display */
										/* eslint-disable-next-line @next/next/no-img-element */
										<img
											src={ensureHttps(allImages[selectedImageIndex] || "")}
											alt={parsedResult?.searchQuery || "Selected media"}
											className="w-full h-full object-cover"
										/>
									)}
									{/* Replace overlay for non-current images - only shows on hover (images only) */}
									{!isVideo && selectedImageIndex !== 0 && (
										<button
											onClick={handleSwapImage}
											className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 cursor-pointer opacity-0 group-hover/preview:opacity-100 transition-opacity"
										>
											<div className="w-12 h-12 rounded-full bg-intents-ux-actionPrimary-backgroundColor flex items-center justify-center">
												<RefreshCw className="w-6 h-6 text-intents-ux-actionPrimary-foregroundColor" />
											</div>
											<span className="text-white font-medium text-sm">
												Replace
											</span>
										</button>
									)}
								</div>

								{/* Alternatives picker strip */}
								{allImages.length > 1 && (
									<div className="flex gap-2 mt-3 flex-wrap">
										{allImages.map((url, index) => {
											const isCurrentImage = index === 0;
											const isSelected = selectedImageIndex === index;

											return (
												<button
													key={index}
													onClick={() => {
														if (isSelected && !isCurrentImage) {
															// Clicking selected non-current image triggers swap
															handleSwapImage();
														} else {
															setSelectedImageIndex(index);
														}
													}}
													className={`group/thumb relative w-16 h-16 rounded-md overflow-hidden border-2 transition-all flex-shrink-0 ${
														isSelected
															? "border-primary ring-1 ring-primary"
															: "border-transparent hover:border-border"
													}`}
												>
													{/* eslint-disable-next-line @next/next/no-img-element */}
													<img
														src={ensureHttps(url)}
														alt={`Option ${index + 1}`}
														className="w-full h-full object-cover"
													/>
													{/* Status bar at top of thumbnail */}
													{isSelected && (
														<div
															className={`absolute inset-x-0 top-0 py-0.5 bg-intents-ux-box-backgroundColor ${
																!isCurrentImage
																	? "group-hover/thumb:bg-intents-ux-actionPrimary-backgroundColor"
																	: ""
															}`}
														>
															<span
																className={`text-[10px] font-medium block text-center ${
																	!isCurrentImage
																		? "group-hover/thumb:text-intents-ux-actionPrimary-foregroundColor"
																		: ""
																}`}
															>
																{isCurrentImage ? "Current" : "Replace"}
															</span>
														</div>
													)}
												</button>
											);
										})}
									</div>
								)}
							</div>
						</motion.div>
					</>
				)}
			</AnimatePresence>
		);

	// Show header when running or error
	if (toolStatus !== "completed" || !hasResult) {
		return (
			<ToolHeader
				icon={
					<Image className="w-2 h-2" />
				} /* eslint-disable-line jsx-a11y/alt-text */
				displayName="Selecting media..."
				toolStatus={toolStatus}
				hasDetails={false}
			/>
		);
	}

	// Count of alternative options
	const alternativeCount = parsedResult.alternatives?.length || 0;

	// Completed state - show single image with slot name
	return (
		<div className="my-2">
			<button
				ref={cardRef}
				onClick={() => handleOpenModal(0)}
				className="flex items-start gap-3 cursor-pointer group"
			>
				{/* Selected media preview (thumbnail for videos, image for images) */}
				<div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={ensureHttps(previewUrl || "")}
						alt={parsedResult.searchQuery}
						className="w-full h-full object-cover group-hover:scale-105 transition-transform"
					/>
				</div>

				{/* Slot info */}
				<div className="text-left">
					<p className="text-sm font-medium">
						{formatSlotName(parsedResult.slot)}
					</p>
					{alternativeCount > 0 && (
						<p className="text-xs text-intents-ux-textSubtle-textColor mt-0.5">
							{alternativeCount} other option{alternativeCount !== 1 ? "s" : ""}
						</p>
					)}
				</div>
			</button>

			{createPortal(modalContent, document.body)}
		</div>
	);
}

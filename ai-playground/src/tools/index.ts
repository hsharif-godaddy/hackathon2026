export { calculatorTool } from './calculator'
export { weatherTool } from './weather'
export { taskPlannerTool } from './task-planner'
export { imageGenerationTool } from './image-generator'
export { htmlFileEditorTool } from './html-file-editor'

// Export all tools as a convenient object
import { calculatorTool } from './calculator'
import { weatherTool } from './weather'
import { taskPlannerTool } from './task-planner'
import { imageGenerationTool } from './image-generator'
import { htmlFileEditorTool } from './html-file-editor'

export const tools = {
  calculator: calculatorTool,
  weather: weatherTool,
  task_planner: taskPlannerTool,
  image_generator: imageGenerationTool,
  html_file_editor: htmlFileEditorTool
}

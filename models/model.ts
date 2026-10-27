import mongoose, { Schema, Document, models } from "mongoose";

interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  resetPasswordToken: string;
  resetPasswordExpires: Date;
}

interface IModel extends Document {
  name: string;
  json: Record<string, any>;
  creator: IUser["_id"];
  participants: IUser["_id"][];
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});

const ModelSchema = new Schema<IModel>({
  name: { type: String, required: true },
  json: { type: Schema.Types.Mixed, required: true },
  creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
});

/**
 * One participant's run of the user study (src/app/[locale]/study): the
 * questionnaire answers, each task's resulting layout and time, as the study
 * page sends them after every step. Keyed by the participant id the page
 * makes up, so a step re-sent after a failed save lands on the same record.
 */
interface IStudySession extends Document {
  participantId: string;
  data: Record<string, any>;
}

const StudySessionSchema = new Schema<IStudySession>(
  {
    participantId: { type: String, required: true, unique: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

const User = models.User || mongoose.model<IUser>("User", UserSchema);
const Model = models.Model || mongoose.model<IModel>("Model", ModelSchema);
const StudySession =
  models.StudySession ||
  mongoose.model<IStudySession>("StudySession", StudySessionSchema);

export { User, Model, StudySession };

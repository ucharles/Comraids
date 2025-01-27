const HttpError = require("../util/http-error");
const { diffDate } = require("../util/diff-date");
const { validationResult } = require("express-validator");

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../models/user-model");
const Event = require("../models/event-model");
const Token = require("../models/token-model");

const { v4: uuid } = require("uuid");

const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;
const JWT_EXPIRES_ACCESS_TOKEN = process.env.JWT_EXPIRES_ACCESS_TOKEN;
const JWT_EXPIRES_REFRESH_TOKEN = process.env.JWT_EXPIRES_REFRESH_TOKEN;

const signup = async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid input passed, please check your data.", 422)
    );
  }

  const { username, email, password, confirmPassword } = req.body;

  let existingUser;
  try {
    existingUser = await User.findOne({ email: email });
  } catch (err) {
    const error = new HttpError("Signup error, please try again.", 500);
    return next(error);
  }

  if (existingUser) {
    const error = new HttpError(
      "User exists already, please login instead.",
      422
    );
    return next(error);
  }

  if (password !== confirmPassword) {
    const error = new HttpError(
      "Password unmatch. Please confirm password.",
      422
    );
    return next(error);
  }

  // password 암호화
  let hashedPassword;
  try {
    hashedPassword = await bcrypt.hash(password, 12);
  } catch (err) {
    const error = new HttpError(
      "Could not create user, Please try again.",
      500
    );
    return next(error);
  }

  let image;
  try {
    image = req.file.path;
  } catch (error) {
    image = null;
  }

  const createdUser = new User({
    username,
    email,
    image: image,
    password: hashedPassword,
    calendars: [],
  });

  try {
    await createdUser.save();
  } catch (err) {
    const error = new HttpError("Signing up falied, please try again.", 500);
    return next(error);
  }

  res.status(201).send();
};

const login = async (req, res, next) => {
  const { email, password } = req.body;

  let existingUser;
  try {
    existingUser = await User.findOne({ email: email.toLowerCase() });
  } catch (err) {
    const error = new HttpError("Signup error, please try again.", 500);
    return next(error);
  }

  if (!existingUser) {
    const error = new HttpError(
      "Invalid credentials, could not log you in.",
      403
    );
    return next(error);
  }

  let isValidPassword = false;
  try {
    isValidPassword = await bcrypt.compare(password, existingUser.password);
  } catch (err) {
    const error = new HttpError("Colud not login, please check", 500);
    return next(error);
  }

  if (!isValidPassword) {
    const error = new HttpError(
      "Invalid credentials, could not log you in.",
      403
    );
    return next(error);
  }

  // JWT 토큰 생성
  let accessToken;
  let refreshToken;

  const id = uuid();

  const createdRefreshToken = new Token({
    uuid: id,
    userId: existingUser._id.toString(),
  });

  try {
    accessToken = jwt.sign(
      {
        userId: existingUser.id,
      },
      JWT_PRIVATE_KEY,
      { expiresIn: JWT_EXPIRES_ACCESS_TOKEN }
    );
    refreshToken = jwt.sign(
      {
        uuid: id,
      },
      JWT_PRIVATE_KEY,
      { expiresIn: JWT_EXPIRES_REFRESH_TOKEN }
    );

    await createdRefreshToken.save();
  } catch (err) {
    const error = new HttpError(
      "Logging in failed, please try again later.",
      500
    );
    return next(error);
  }

  res
    .status(201)
    .cookie("at", accessToken, {
      path: "/",
      expires: new Date(Date.now() + 1000 * 60 * 60),
      httpOnly: true,
    })
    .cookie("rt", refreshToken, {
      path: "/",
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      httpOnly: true,
    })
    .cookie("loggedIn", 1, {
      path: "/",
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    })
    .send();
};

const getUserById = async (req, res, next) => {
  // 회원정보 수정 전 정보 표시
  let user;

  try {
    // 결과 중 password를 제외함
    user = await User.findById(req.userData.userId, "-password");
  } catch (err) {
    const error = HttpError(
      "something error getting users! please check.",
      500
    );
    return next(error);
  }

  if (!user) {
    const error = new HttpError("Could not find user for provided id", 404);
    return next(error);
  }

  res.status(200).json({ user });
  // .json({ user: user.map((user) => user.toObject({ getters: true })) });
};

const getTokenAndCheck = async (req, res, next) => {
  try {
    const accessToken = req.cookies.at;
    const refreshToken = req.cookies.rt;

    // 리프레시 토큰이 없는 경우
    if (!refreshToken) {
      throw new Error("Authentication failed!");
    }
    const decodedRefreshToken = jwt.verify(refreshToken, JWT_PRIVATE_KEY);

    if (!accessToken) {
      let storedToken;
      try {
        storedToken = await Token.findOne({ uuid: decodedRefreshToken.uuid });
      } catch (err) {
        const error = new HttpError("DB error, please try again.", 500);
        return next(error);
      }

      if (storedToken.userId === undefined) {
        const error = new HttpError("Can't create Access Token.", 403);
        return next(error);
      }

      req.userData = { userId: storedToken.userId };

      // 액세스 토큰 재발급
      let newAccessToken;

      try {
        newAccessToken = jwt.sign(
          {
            userId: req.userData.userId,
          },
          JWT_PRIVATE_KEY,
          { expiresIn: JWT_EXPIRES_ACCESS_TOKEN }
        );
      } catch (err) {
        const error = new HttpError(
          "Logging in failed, please try again later.",
          500
        );
        return next(error);
      }
      res
        .status(200)
        .cookie("at", newAccessToken, {
          path: "/",
          expires: new Date(Date.now() + 1000 * 60 * 60),
          httpOnly: true,
        })
        .send();
    } else if (accessToken) {
      jwt.verify(accessToken, JWT_PRIVATE_KEY);
      res.status(200).send();
    }
  } catch (err) {
    const error = new HttpError("Authentication failed!", 403);
    return next(error);
  }
};

const editUser = async (req, res, next) => {
  // 회원 정보 수정
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }
  const { username, password } = req.body;

  let user;
  try {
    user = await User.findById(req.userData.userId).exec();
  } catch (err) {
    const error = new HttpError(
      "something went wrong, could not update a place.",
      500
    );
    return next(error);
  }
  if (user._id.toString() !== req.userData.userId) {
    const error = new HttpError("You are not allowed to edit this user.", 401);
    return next(error);
  }

  // password 암호화
  if (password) {
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, 12);
    } catch (err) {
      const error = new HttpError(
        "Could not create user, Please try again.",
        500
      );
      return next(error);
    }
    user.password = hashedPassword;
  }

  let image;
  try {
    image = req.file.path;
  } catch (error) {
    image = null;
  }

  user.username = username;
  user.image = image;

  try {
    await user.save();
  } catch (err) {
    const error = new HttpError(
      "Something went wrong, could not update user.",
      500
    );
    return next(error);
  }

  res.status(201).send();
};

const deleteUser = async (req, res, next) => {
  // 회원 정보 삭제
  const userId = req.userData.userId;
  // 달력 생성자인 경우엔 삭제 불가. 달력을 삭제해야 함.(다른 사람에게 양도하거나?)

  let user;
  try {
    user = await User.findById(userId).populate("calendars").exec();
  } catch (err) {
    const error = new HttpError("Could not found user by id.", 500);
    return next(error);
  }

  if (!user) {
    const error = new HttpError("Could not find user for this id.", 404);
    return next(error);
  }

  // 속한 캘린더 중에 생성자가 자신인 캘린더가 있는 경우
  if (
    !!user.calendars.find((v) => {
      return v.owner.toString() === userId;
    })
  ) {
    const error = new HttpError(
      "Delete or Change owner, by owned calendar first.",
      404
    );
    return next(error);
  }

  let deleteIndexArray = [];
  for (const calendar of user.calendars) {
    deleteIndexArray.push({
      calendarId: calendar._id,
      deleteIndex: calendar.members.findIndex((member) => {
        return member._id.toString() === userId;
      }),
    });
  }

  // 트랜잭션 사용. 두 작업이 모두 완료되거나, 두 작업이 모두 수행되지 않거나.
  try {
    const sess = await mongoose.startSession();
    await sess.withTransaction(async () => {
      for (let calendar of user.calendars) {
        let deleteInfo = deleteIndexArray.find((v) => {
          return v.calendarId.toString() === calendar._id.toString();
        });
        calendar.members.splice(deleteInfo.deleteIndex, 1);
        await calendar.save({ session: sess });
      }
      await user.delete({ session: sess });
      await Event.deleteMany({ creator: userId }).session(sess);
    });
    sess.endSession();
  } catch (err) {
    console.log(err);
    const error = new HttpError(
      "Can not delete user, Can not delete user's events.",
      500
    );
    return next(error);
  }

  // 이미지 삭제
  // fs.unlink(user.image, (err) => {
  //   err === null
  //     ? console.log("delete image: " + user.image)
  //     : console.log(err);
  // });

  // 일정만 등록한 경우엔 삭제 가능. 일정이 전부 삭제되진 않음.
  //res.clearCookie("XSRF-TOKEN");
  res.clearCookie("at");
  res.clearCookie("rt");
  res.status(200).send();
};

const logout = (req, res, next) => {
  //res.clearCookie("XSRF-TOKEN");
  res.clearCookie("loggedIn");
  res.clearCookie("at");
  res.clearCookie("rt");
  res.clearCookie("tz");
  res.status(200).send();
};

exports.getUserById = getUserById;
exports.getTokenAndCheck = getTokenAndCheck;
exports.editUser = editUser;
exports.deleteUser = deleteUser;
exports.login = login;
exports.logout = logout;
exports.signup = signup;
